import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle, AgentOptions, AgentSetup, ModelSelectionRef, PreStepDecision as AgentPreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandRuntime, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import '../shared/augmentations.js'
import { defaultRuntimeSettings } from '../config.js'
import { registerQQImageTool } from '../media/image-tool.js'
import { registerQQMediaTools } from '../media/media-tools.js'
import { dispatchQQCommand, qqCommandText } from '../commands/dispatch.js'
import type { QQChatDatabase } from '../storage/db.js'
import type { MemoryEngine } from '../storage/memory.js'
import type {
  ChatType,
  GroupRow,
  LoggerLike,
  MemberRow,
  PendingReply,
  StoredAttachmentSummary,
  QQChatConfig,
  QQChatDisplayEvent,
  QQNormalizedMessage,
} from '../types.js'
import { MEMORY_SNAPSHOT_TTL_MS, memorySnapshotHash, restoreMemorySnapshotState, shouldRefreshMemorySnapshot } from './memory-snapshot.js'
import type { MemorySnapshotState } from './memory-snapshot.js'

const DSH_RUNTIME_CONTEXT_SOURCE = '@deepseek-ai/dsh-system-prompt'

interface AgentPreset { id: string }
interface AgentPresetService { resolve(id?: string): Promise<AgentPreset>; mount(ctx: Context, id: string): Promise<unknown> }
interface SessionTitleService { get(session: Session): unknown; rename(session: Session, title: string): unknown }
interface WorkspaceRegistryService { archivedSessionIds: readonly string[] }
interface Composition { presetId?: string; setup?: AgentSetup }
interface ActiveActor { chatType: ChatType; senderId: string }

const MEDIA_TOOL_NAMES = new Set(['qqchat_describe_image', 'qqchat_read_file', 'qqchat_media_info'])
const packageMetadata = createRequire(import.meta.url)('../../package.json') as { version?: string }
const PLUGIN_VERSION = packageMetadata.version || 'unknown'

export class DshQQBridge {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly pending = new Map<string, PendingReply>()
  private readonly routes = new Map<string, { provider: string; model: string }>()
  private readonly selections = new Map<string, { ref: ModelSelectionRef; dispose: () => void }>()
  private readonly pendingResets = new Set<string>()
  private readonly activeActors = new Map<string, ActiveActor>()
  private readonly activeAttachments = new Map<string, Set<string>>()
  private readonly activeMediaReadable = new Map<string, boolean>()
  private readonly memorySnapshots = new Map<string, MemorySnapshotState>()
  private readonly disposeEvent: () => void
  private readonly disposeToolGate: () => void
  private readonly disposeBootstrapGate: () => void
  private readonly disposeCommands: () => void
  private readonly disposeImageTool: () => void
  private readonly disposeMediaTools: () => void

  constructor(
    private readonly ctx: Context,
    private readonly db: QQChatDatabase,
    private readonly memory: MemoryEngine,
    private readonly config: QQChatConfig,
    private readonly logger: LoggerLike = console,
  ) {
    this.disposeEvent = ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
    this.disposeBootstrapGate = ctx.on('agent/pre-step', async ({ messages }, next): Promise<AgentPreStepDecision> => {
      if (messages.some(message => message.source.kind === 'qq-chat-bootstrap')) return { kind: 'reject' }
      return next()
    })
    this.disposeToolGate = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      const agent = exec.agent
      if (!agent) return next()
      const actor = this.activeActors.get(String(agent.id))
      if (!actor || actor.chatType !== 'group') return next()
      const settings = this.db.runtimeSettings(defaultRuntimeSettings(this.config))
      if (settings.groupMembersCanUseTools) return next()
      if (settings.ownerUserId && settings.ownerUserId === actor.senderId) return next()
      if (MEDIA_TOOL_NAMES.has(exec.name) && settings.groupMembersCanReadMedia) return next()
      return {
        kind: 'deny',
        reason: settings.ownerUserId
          ? (MEDIA_TOOL_NAMES.has(exec.name) ? '当前 QQ 群已关闭群成员媒体读取权限。' : '当前 QQ 群只允许 Owner 使用工具。')
          : (MEDIA_TOOL_NAMES.has(exec.name) ? '当前 QQ 群已关闭群成员媒体读取权限。' : '当前 QQ 群已关闭群成员工具权限，但尚未设置 Owner stable ID。'),
      }
    })
    const canReadMedia = (agentId: string, attachmentId: string) => this.activeMediaReadable.get(agentId) === true && this.activeAttachments.get(agentId)?.has(attachmentId) === true
    this.disposeImageTool = registerQQImageTool(ctx, db, canReadMedia)
    this.disposeMediaTools = registerQQMediaTools(ctx, db, canReadMedia)
    this.disposeCommands = this.registerCommands()
  }

  async dispose(): Promise<void> {
    this.disposeEvent()
    this.disposeBootstrapGate()
    this.disposeToolGate()
    this.disposeImageTool()
    this.disposeMediaTools()
    this.disposeCommands()
    for (const handle of this.handles.values()) {
      try { await handle.dispose() } catch {}
    }
    this.handles.clear()
    for (const selection of this.selections.values()) selection.dispose()
    this.selections.clear()
    this.pendingResets.clear()
    this.activeActors.clear()
    this.activeAttachments.clear()
    this.activeMediaReadable.clear()
    this.memorySnapshots.clear()
  }

  async ensureChatSession(chatType: ChatType, row: GroupRow | MemberRow): Promise<string> {
    const { sessionId } = await this.ensureAgent(chatType, row)
    return sessionId
  }

  async recordTranscript(event: QQChatDisplayEvent, row: GroupRow | MemberRow, createSession = false): Promise<string | undefined> {
    const existing = this.db.getChatSession(event.chatType, Number(row.id))
    if (!existing && !createSession) return undefined
    const { agent, sessionId } = await this.ensureAgent(event.chatType, row)
    event.sessionId = sessionId
    if (event.isOwner) {
      const hasImages = event.attachments?.some(attachment => attachment.kind === 'image' && this.db.attachmentById(attachment.id)?.imageRef) === true
      if (!hasImages || await this.imageRouteAvailable(agent)) this.appendOwnerMessageIfMissing(agent.session, event)
      else this.appendDisplayIfMissing(agent.session, event)
      return sessionId
    }
    this.appendDisplayIfMissing(agent.session, event)
    return sessionId
  }

  async reply(message: QQNormalizedMessage, group: GroupRow | undefined, member: MemberRow, attachments: StoredAttachmentSummary[] = [], onTextDelta?: (delta: string) => void, isOwner = message.chatType === 'c2c'): Promise<string> {
    if (message.chatType === 'group' && !group) throw new Error('群消息缺少群上下文')
    const key = message.chatType === 'group' ? `g:${group!.id}` : `u:${member.id}`
    return this.serial(key, async () => {
      const row = message.chatType === 'group' ? group! : member
      const { agent, sessionId } = await this.ensureAgent(message.chatType, row)
      this.activeActors.set(String(sessionId), { chatType: message.chatType, senderId: message.senderId })
      try {
        const commands = (this.ctx as unknown as { commands?: CommandRuntime }).commands
        const commandText = qqCommandText(message.text, message.mentioned)
        if (commandText !== undefined) {
          if (!commands) return '当前 DSH profile 未加载命令系统，请重启并确认使用了最新插件。'
          const command = await dispatchQQCommand(commands, agent, commandText, { chatType: message.chatType, isOwner })
          if (command.handled) {
            if (this.pendingResets.delete(String(sessionId))) await this.resetSession(message.chatType, row)
            return command.text || ''
          }
        }
      } finally {
        this.activeActors.delete(String(sessionId))
      }

      await agent.whenIdle()

      if (this.db.runtimeSettings(defaultRuntimeSettings(this.config)).memoryEnabled) {
        const contextText = message.chatType === 'group'
          ? this.memory.contextForGroup(group!, member)
          : this.memory.contextForMember(member)
        this.injectMemorySnapshot(agent, sessionId, contextText)
      }

      const currentText = this.memory.currentMessageText(message) + mediaPrompt(attachments)
      const currentContent: ContentBlock[] = [{ type: 'text', text: currentText }]
      if (attachments.length && await this.imageRouteAvailable(agent)) {
        for (const attachment of attachments) {
          if (attachment.kind === 'image' && attachment.imageRef) {
            currentContent.push({ type: 'image', attachment: attachment.imageRef })
          }
        }
      }
      const current = createUserMessage({
        source: {
          kind: 'qq-chat', botId: String(message.accountId), chatType: message.chatType,
          chatId: message.chatId, senderId: message.senderId,
          ...(message.senderName ? { senderName: message.senderName } : {}),
          messageId: message.messageId || '', mentioned: Boolean(message.mentioned),
          form: 'notice',
          summary: `QQ ${message.chatType === 'group' ? '群聊' : '私聊'}消息 · ${message.senderName || shortId(message.senderId)}`,
        },
        content: currentContent,
      })

      this.pending.set(String(sessionId), { text: '', onTextDelta })
      this.activeAttachments.set(String(sessionId), new Set(attachments.map(item => item.id)))
      const settings = this.db.runtimeSettings(defaultRuntimeSettings(this.config))
      this.activeMediaReadable.set(String(sessionId), message.chatType !== 'group'
        || (settings.ownerUserId !== '' && settings.ownerUserId === message.senderId)
        || settings.groupMembersCanReadMedia)
      this.activeActors.set(String(sessionId), { chatType: message.chatType, senderId: message.senderId })
      try {
        agent.followup(current)
        await agent.whenIdle()
      } finally {
        this.activeActors.delete(String(sessionId))
        this.activeAttachments.delete(String(sessionId))
        this.activeMediaReadable.delete(String(sessionId))
      }

      const pending = this.pending.get(String(sessionId))
      this.pending.delete(String(sessionId))
      const route = this.routes.get(String(sessionId)) || { provider: agent.options.provider, model: agent.options.model }
      if (message.chatType === 'group' && route.provider && route.model) {
        this.memory.setRoute(Number(group!.id), route.provider, route.model, String(sessionId))
      } else if (message.chatType === 'c2c' && route.provider && route.model) {
        this.memory.setMemberRoute(Number(member.id), route.provider, route.model, String(sessionId))
      }
      const text = pending?.text.trim()
      if (!text) throw new Error('DSH Agent 本轮没有产生可发送的文本回复')
      return text
    })
  }

  private onSessionEvent(session: Session, event: SessionEvent): void {
    const id = String(session.id)
    if (event.type === 'assistant/message') {
      const pending = this.pending.get(id)
      if (!pending) return
      const text = extractText(event.data.message.content)
      if (text.trim()) pending.text = text
      return
    }
    if (event.type === 'assistant/chunk') {
      const pending = this.pending.get(id)
      const chunk = event.data.chunk
      if (pending?.onTextDelta && chunk.type === 'text-delta' && chunk.text) pending.onTextDelta(chunk.text)
      return
    }
    if (event.type === 'request/header') {
      const { config } = event.data.header
      if (config.provider && config.model) this.routes.set(id, { provider: config.provider, model: config.model })
      return
    }
    if ((event.type as string) === 'compaction/end') {
      const state = this.memorySnapshots.get(id)
      if (state) state.stale = true
    }
  }

  private injectMemorySnapshot(agent: AgentHandle['agent'], sessionId: string, contextText: string): void {
    const now = Date.now()
    const hash = memorySnapshotHash(contextText)
    const previous = this.memorySnapshots.get(sessionId) || this.restoreMemorySnapshot(agent.session)
    if (shouldRefreshMemorySnapshot(previous, contextText, now, MEMORY_SNAPSHOT_TTL_MS)) {
      agent.inject(createUserMessage({
        source: { kind: 'plugin', plugin: DSH_RUNTIME_CONTEXT_SOURCE, form: 'snapshot', sections: [{ name: 'qq-chat-context', text: contextText }] },
        content: [{ type: 'text', text: contextText }],
      }))
      this.memorySnapshots.set(sessionId, { hash, lastInjectedAt: now, stale: false })
      return
    }
    if (!previous) return
    // Keep the cache fresh without writing another runtime-context event.
    previous.lastInjectedAt = now
    this.memorySnapshots.set(sessionId, previous)
  }

  private restoreMemorySnapshot(session: Session): MemorySnapshotState | undefined {
    return restoreMemorySnapshotState(session.events as unknown as Parameters<typeof restoreMemorySnapshotState>[0], DSH_RUNTIME_CONTEXT_SOURCE)
  }

  private async ensureAgent(chatType: ChatType, row: GroupRow | MemberRow): Promise<{ agent: AgentHandle['agent']; sessionId: string }> {
    let sessionId = this.db.getChatSession(chatType, Number(row.id))
    if (sessionId) {
      if (this.isArchived(sessionId)) {
        const old = this.handles.get(sessionId)
        if (old) {
          try { await old.dispose() } catch {}
          this.handles.delete(sessionId)
        }
        this.logger.info?.(`[dsh-qqchat] QQ session ${sessionId} 已归档，将创建新 session`)
        sessionId = null
      }
    }
    if (sessionId) {
      const live = this.ctx.agents.get(SessionId(sessionId))
      if (live) {
        this.ensureSelection(live)
        this.ensureTitle(live.session, chatType, row)
        this.rememberRoute(chatType, row, live, sessionId)
        await this.ensureVisible(live)
        return { agent: live, sessionId }
      }
      const resumed = await this.tryResume(sessionId)
      if (resumed) {
        this.ensureSelection(resumed.agent)
        this.ensureTitle(resumed.agent.session, chatType, row)
        this.rememberRoute(chatType, row, resumed.agent, sessionId)
        await this.ensureVisible(resumed.agent)
        return { agent: resumed.agent, sessionId }
      }
    }

    sessionId = `qqchat-${randomUUID()}`
    const composition = await this.composition()
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: {
        cwd: process.cwd(),
        ...(composition.presetId ? { agentPreset: composition.presetId } : {}),
      },
      agentOptions: this.agentOptions(), setup: composition.setup,
    })
    this.handles.set(sessionId, handle)
    this.ensureSelection(handle.agent)
    this.db.setChatSession(chatType, Number(row.id), sessionId)
    this.ensureTitle(handle.agent.session, chatType, row)
    this.rememberRoute(chatType, row, handle.agent, sessionId)
    await this.ensureVisible(handle.agent)
    return { agent: handle.agent, sessionId }
  }

  private isArchived(sessionId: string): boolean {
    const registry = (this.ctx as unknown as { workspaceRegistry?: WorkspaceRegistryService }).workspaceRegistry
    return registry?.archivedSessionIds.includes(sessionId) ?? false
  }

  private rememberRoute(chatType: ChatType, row: GroupRow | MemberRow, agent: AgentHandle['agent'], sessionId: string): void {
    const provider = agent.options.provider || this.config.provider
    const model = agent.options.model || this.config.model
    if (!provider || !model) return
    if (chatType === 'group') this.memory.setRoute(Number((row as GroupRow).id), provider, model, sessionId)
    else this.memory.setMemberRoute(Number((row as MemberRow).id), provider, model, sessionId)
  }

  private async ensureVisible(agent: AgentHandle['agent']): Promise<void> {
    if (agent.session.events.some(event => event.type === 'turn/start')) return
    agent.followup(createUserMessage({ source: { kind: 'qq-chat-bootstrap', plugin: 'dsh-qqchat' }, content: [{ type: 'text', text: 'Activate QQ Chat workspace session.' }] }))
    await agent.whenIdle()
  }

  private appendDisplayIfMissing(session: Session, event: QQChatDisplayEvent): void {
    if (session.events.some(item => item.type === 'qqchat/message' && item.data.messageId === event.messageId)) return
    session.append('qqchat/message', displayEventPayload(event))
  }

  private appendOwnerMessageIfMissing(session: Session, event: QQChatDisplayEvent): void {
    if (session.events.some(item => {
      if (item.type !== 'user/message') return false
      const source = item.data.source as unknown as { messageId?: string }
      return source.messageId === event.messageId
    })) return
    session.append('user/message', createUserMessage({
      source: {
        kind: 'user', channel: 'qq', botId: 'qqchat', chatType: event.chatType,
        chatId: event.chatId, senderId: event.senderId,
        ...(event.senderName ? { senderName: event.senderName } : {}),
        messageId: event.messageId, mentioned: event.mentioned,
      },
      content: transcriptContent(event, this.db),
    }), { surfaceOp: 'append' })
  }

  private ensureTitle(session: Session, chatType: ChatType, row: GroupRow | MemberRow): void {
    try {
      const getService = (this.ctx as unknown as { get?: (name: string) => unknown }).get
      const titles = getService?.call(this.ctx, 'sessionTitle') as SessionTitleService | undefined
      if (!titles || titles.get(session)) return
      const fallback = chatType === 'group'
        ? `QQ群 · ${(row as GroupRow).name || shortId((row as GroupRow).platform_group_id)}`
        : `QQ私聊 · ${(row as MemberRow).display_name || shortId((row as MemberRow).platform_user_id)}`
      titles.rename(session, fallback)
    } catch (error) {
      this.logger.debug?.(`[dsh-qqchat] session title skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async tryResume(sessionId: string): Promise<AgentHandle | undefined> {
    try {
      const composition = await this.composition()
      const handle = await this.ctx.agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions: this.agentOptions(), setup: composition.setup })
      if (!handle.agent.session.header.cwd) {
        await handle.dispose()
        this.logger.warn?.(`[dsh-qqchat] QQ session ${sessionId} 缺少 cwd 元数据，将创建新 session`)
        return undefined
      }
      this.handles.set(sessionId, handle)
      return handle
    } catch (error) {
      this.logger.warn?.(`[dsh-qqchat] 无法恢复 QQ session ${sessionId}，将创建新 session: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  private agentOptions(): AgentOptions {
    const defaults = this.ctx.agentDefaultModel.currentSelection()
    const options: AgentOptions = {
      provider: this.config.provider || defaults.provider,
      model: this.config.model || defaults.model,
    }
    if (this.config.maxTokens) options.maxTokens = this.config.maxTokens
    return options
  }

  private async imageRouteAvailable(agent: AgentHandle['agent']): Promise<boolean> {
    const route = this.selection(agent)?.current || { provider: agent.options.provider, model: agent.options.model }
    if (!route.provider || !route.model) return false
    try {
      const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model)
      return info.inputModalities?.includes('image') === true
    } catch { return false }
  }

  private ensureSelection(agent: AgentHandle['agent']): ModelSelectionRef | undefined {
    const id = String(agent.id)
    const existing = this.selections.get(id)
    if (existing) return existing.ref
    const logged = agent.session.requestHeader()?.config
    const route = this.routes.get(id)
      || (logged?.provider && logged.model ? { provider: logged.provider, model: logged.model } : undefined)
      || (agent.options.provider && agent.options.model ? { provider: agent.options.provider, model: agent.options.model } : undefined)
    if (!route) return undefined
    const ref: ModelSelectionRef = { current: route, assembled: undefined }
    this.selections.set(id, { ref, dispose: installModelSelection(agent.ctx, ref) })
    return ref
  }

  private selection(agent: AgentHandle['agent']): ModelSelectionRef | undefined {
    return this.ensureSelection(agent)
  }

  private requestReset(sessionId: string): void {
    this.pendingResets.add(sessionId)
  }

  private async resetSession(chatType: ChatType, row: GroupRow | MemberRow): Promise<void> {
    const sessionId = this.db.getChatSession(chatType, Number(row.id))
    if (!sessionId) return
    const handle = this.handles.get(sessionId)
    if (handle) {
      try { await handle.dispose() } catch {}
      this.handles.delete(sessionId)
    }
    const selection = this.selections.get(sessionId)
    if (selection) {
      selection.dispose()
      this.selections.delete(sessionId)
    }
    this.routes.delete(sessionId)
    this.db.setChatSession(chatType, Number(row.id), '')
  }

  private commandHelp(agent: AgentHandle['agent']): string {
    const commands = this.ctx.commands.list(agent)
    return [
      '🤖 QQChat / DSH 命令',
      '',
      '通用能力',
      ...commands.filter(command => ['compact', 'goal', 'plan', 'permission', 'feedback'].includes(command.name))
        .map(command => `/${command.name}${command.input?.hint ? ` ${command.input.hint}` : ''} — ${command.description}`),
      '',
      'QQChat 会话',
      ...commands.filter(command => ['qqnew', 'qqreset', 'qqclear', 'qqmodel', 'qqstop', 'qqstatus'].includes(command.name))
        .map(command => `/${command.name}${command.input?.hint ? ` ${command.input.hint}` : ''} — ${command.description}`),
      '',
      'QQChat 工具',
      ...commands.filter(command => ['qqping', 'qqversion', 'qqhelp', 'qqcommands'].includes(command.name))
        .map(command => `/${command.name} — ${command.description}`),
    ].join('\n')
  }

  private registerCommands(): () => void {
    const register = (name: string, description: string, handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>, input?: string): (() => void) =>
      this.ctx.commands.register({ name, description, ...(input ? { input: { hint: input } } : {}), handler })
    const disposers = [
      register('qqhelp', '查看 QQChat 和 DSH 命令', invocation => ({ kind: 'success', text: this.commandHelp(invocation.agent as AgentHandle['agent']) })),
      register('qqcommands', '查看 QQChat 和 DSH 命令', invocation => ({ kind: 'success', text: this.commandHelp(invocation.agent as AgentHandle['agent']) })),
      register('qqnew', '开始新会话（保留旧 Session）', invocation => { this.requestReset(String(invocation.agent.id)); return { kind: 'success', text: '已开启新会话，下一条消息将进入新的 Session。' } }),
      register('qqreset', '开始新会话（/qqnew 别名）', invocation => { this.requestReset(String(invocation.agent.id)); return { kind: 'success', text: '已开启新会话，下一条消息将进入新的 Session。' } }),
      register('qqclear', '开始新会话（/qqnew 别名）', invocation => { this.requestReset(String(invocation.agent.id)); return { kind: 'success', text: '已开启新会话，下一条消息将进入新的 Session。' } }),
      register('qqmodel', '查看或切换当前会话模型', invocation => this.modelCommand(invocation), '[provider/]model'),
      register('qqstop', '中止当前生成', invocation => {
        if (invocation.agent.status !== 'running') return { kind: 'success', text: '当前没有进行中的生成。' }
        invocation.agent.cancel({ kind: 'user' })
        return { kind: 'success', text: '已中止当前生成。' }
      }),
      register('qqping', '测试 QQChat 连通性', () => ({ kind: 'success', text: 'pong 🏓' })),
      register('qqversion', '查看 QQChat 版本', () => ({ kind: 'success', text: `dsh-qqchat v${PLUGIN_VERSION}` })),
      register('qqstatus', '查看当前会话状态', invocation => this.statusCommand(invocation.agent as AgentHandle['agent'])),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }

  private async modelCommand(invocation: CommandInvocation): Promise<CommandResult> {
    const agent = invocation.agent as AgentHandle['agent']
    const ref = this.selection(agent)
    if (!ref) return { kind: 'error', text: '当前 Session 尚未确定模型路由。' }
    const args = invocation.rawInput.trim()
    if (!args) {
      const providers = this.ctx.llm.listProviders()
      const models = await this.ctx.llm.listModels(ref.current?.provider || '')
      return {
        kind: 'success',
        text: [
          `当前模型：${ref.current?.provider}/${ref.current?.model}`,
          providers.length ? `可用提供方：${providers.map(provider => provider.id).join(', ')}` : '',
          models.length ? `当前提供方模型：${models.slice(0, 20).map(model => `${model.id}${model.name !== model.id ? `（${model.name}）` : ''}`).join(', ')}` : '',
          '切换用法：/qqmodel provider/model 或 /qqmodel model',
        ].filter(Boolean).join('\n'),
      }
    }
    const separator = args.indexOf('/')
    const provider = separator > 0 ? args.slice(0, separator).trim() : ref.current?.provider || ''
    const model = separator > 0 ? args.slice(separator + 1).trim() : args
    if (!provider || !model) return { kind: 'error', text: '用法：/qqmodel provider/model' }
    if (!this.ctx.llm.listProviders().some(item => item.id === provider)) {
      return { kind: 'error', text: `未找到提供方：${provider}` }
    }
    ref.current = { provider, model }
    this.routes.set(String(agent.id), { provider, model })
    return { kind: 'success', text: `模型已切换：${provider}/${model}\n对话上下文保留，下一轮生效。` }
  }

  private statusCommand(agent: AgentHandle['agent']): CommandResult {
    const current = this.selection(agent)?.current
    const messages = agent.session.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message').length
    const last = agent.session.events.at(-1)
    return {
      kind: 'success',
      text: ['📊 Session 状态', `Session：${String(agent.id)}`, `状态：${agent.status === 'running' ? '生成中' : '空闲'}`, `模型：${current ? `${current.provider}/${current.model}` : '未知'}`, `消息数：${messages}`, `最后事件：${last?.type || '无'}`].join('\n'),
    }
  }

  private async composition(): Promise<Composition> {
    const getService = (this.ctx as unknown as { get?: (name: string) => unknown }).get
    const presets = getService?.call(this.ctx, 'agentPresets') as AgentPresetService | undefined
    if (!presets) return {}
    const preset = await presets.resolve(this.config.agentPreset)
    return { presetId: preset.id, setup: async agentCtx => { await presets.mount(agentCtx, preset.id) } }
  }

  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) || Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.locks.set(key, current)
    return current.finally(() => { if (this.locks.get(key) === current) this.locks.delete(key) })
  }
}

function mediaPrompt(attachments: StoredAttachmentSummary[]): string {
  if (!attachments.length) return ''
  const lines = attachments.map(item => `- ${item.kind}: ${item.filename} (attachment_id=${item.id}${item.quoted ? ', 引用消息附件' : ''})`)
  return `\n\n[QQ 媒体附件]\n${lines.join('\n')}\n图片可使用 qqchat_describe_image 查看。`
}

function transcriptContent(event: QQChatDisplayEvent, db: QQChatDatabase): ContentBlock[] {
  const attachments = event.attachments || []
  const renderableImages = attachments.filter(attachment => attachment.kind === 'image' && db.attachmentById(attachment.id)?.imageRef)
  const imagePlaceholderLines = new Set(renderableImages.map(attachment => `[图片] ${attachment.filename}`))
  const text = event.content.split('\n').filter(line => !imagePlaceholderLines.has(line)).join('\n').trim()
  const content: ContentBlock[] = [{ type: 'text', text }]
  for (const attachment of attachments) {
    const imageRef = attachment.kind === 'image' ? db.attachmentById(attachment.id)?.imageRef : undefined
    if (imageRef) {
      content.push({ type: 'image', attachment: imageRef })
    }
  }
  return content
}

function displayEventPayload(event: QQChatDisplayEvent): QQChatDisplayEvent {
  const attachments = (event.attachments || []).map(attachment => ({
    id: String(attachment.id), kind: attachment.kind, filename: String(attachment.filename),
    ...(attachment.contentType ? { contentType: String(attachment.contentType) } : {}),
    sizeBytes: Number(attachment.sizeBytes || 0), quoted: Boolean(attachment.quoted),
  }))
  const quote = event.quote ? {
    ...(event.quote.messageId ? { messageId: String(event.quote.messageId) } : {}),
    ...(event.quote.senderId ? { senderId: String(event.quote.senderId) } : {}),
    ...(event.quote.senderName ? { senderName: String(event.quote.senderName) } : {}),
    text: String(event.quote.text || ''),
    attachments: event.quote.attachments.map(attachment => ({
      filename: String(attachment.filename),
      ...(attachment.contentType ? { contentType: String(attachment.contentType) } : {}),
      ...(attachment.size !== undefined ? { size: Number(attachment.size) } : {}),
      ...(attachment.width !== undefined ? { width: Number(attachment.width) } : {}),
      ...(attachment.height !== undefined ? { height: Number(attachment.height) } : {}),
      ...(attachment.durationMs !== undefined ? { durationMs: Number(attachment.durationMs) } : {}),
      ...(attachment.platformFileId ? { platformFileId: String(attachment.platformFileId) } : {}),
      ...(attachment.quoted !== undefined ? { quoted: Boolean(attachment.quoted) } : {}),
      ...(attachment.kind ? { kind: attachment.kind } : {}),
    })),
  } : undefined
  return {
    messageId: String(event.messageId), chatType: event.chatType, chatId: String(event.chatId),
    direction: event.direction, senderId: String(event.senderId), senderName: String(event.senderName),
    ...(event.isOwner !== undefined ? { isOwner: Boolean(event.isOwner) } : {}),
    content: String(event.content), quotedText: String(event.quotedText), mentioned: Boolean(event.mentioned),
    createdAt: Number(event.createdAt), ...(event.sessionId ? { sessionId: String(event.sessionId) } : {}),
    attachments, ...(quote ? { quote } : {}),
  }
}

function extractText(content: readonly unknown[]): string {
  return content.filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}

function shortId(value: string): string { return value.length > 10 ? `…${value.slice(-10)}` : value }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
