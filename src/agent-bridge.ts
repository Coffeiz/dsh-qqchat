import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, AgentOptions, AgentSetup, PreStepDecision as AgentPreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import './dsh-augmentations.js'
import { defaultRuntimeSettings } from './config.js'
import type { QQChatDatabase } from './db.js'
import type { MemoryEngine } from './memory.js'
import type {
  ChatType,
  GroupRow,
  LoggerLike,
  MemberRow,
  PendingReply,
  QQChatConfig,
  QQChatDisplayEvent,
  QQNormalizedMessage,
} from './types.js'

interface AgentPreset { id: string }
interface AgentPresetService { resolve(id?: string): Promise<AgentPreset>; mount(ctx: Context, id: string): Promise<unknown> }
interface SessionTitleService { get(session: Session): unknown; rename(session: Session, title: string): unknown }
interface WorkspaceRegistryService { archivedSessionIds: readonly string[] }
interface Composition { presetId?: string; setup?: AgentSetup }
interface ActiveActor { chatType: ChatType; senderId: string }

export class DshQQBridge {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly pending = new Map<string, PendingReply>()
  private readonly routes = new Map<string, { provider: string; model: string }>()
  private readonly activeActors = new Map<string, ActiveActor>()
  private readonly disposeEvent: () => void
  private readonly disposeToolGate: () => void
  private readonly disposeBootstrapGate: () => void

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
      return {
        kind: 'deny',
        reason: settings.ownerUserId
          ? '当前 QQ 群只允许 Owner 使用工具。'
          : '当前 QQ 群已关闭群成员工具权限，但尚未设置 Owner stable ID。',
      }
    })
  }

  async dispose(): Promise<void> {
    this.disposeEvent()
    this.disposeBootstrapGate()
    this.disposeToolGate()
    for (const handle of this.handles.values()) {
      try { await handle.dispose() } catch {}
    }
    this.handles.clear()
    this.activeActors.clear()
  }

  async ensureChatSession(chatType: ChatType, row: GroupRow | MemberRow): Promise<string> {
    const { sessionId } = await this.ensureAgent(chatType, row)
    return sessionId
  }

  async recordTranscript(event: QQChatDisplayEvent, row: GroupRow | MemberRow, createSession = false): Promise<string | undefined> {
    const existing = this.db.getChatSession(event.chatType, Number(row.id))
    if (!existing && !createSession) return undefined
    const { agent, sessionId } = await this.ensureAgent(event.chatType, row)
    if (event.isOwner) {
      this.appendOwnerMessageIfMissing(agent.session, event)
      return sessionId
    }
    this.appendDisplayIfMissing(agent.session, event)
    return sessionId
  }

  async reply(message: QQNormalizedMessage, group: GroupRow | undefined, member: MemberRow): Promise<string> {
    if (message.chatType === 'group' && !group) throw new Error('群消息缺少群上下文')
    const key = message.chatType === 'group' ? `g:${group!.id}` : `u:${member.id}`
    return this.serial(key, async () => {
      const row = message.chatType === 'group' ? group! : member
      const { agent, sessionId } = await this.ensureAgent(message.chatType, row)
      await agent.whenIdle()

      const contextText = message.chatType === 'group'
        ? this.memory.contextForGroup(group!, member, message.messageId || undefined)
        : this.memory.contextForMember(member)
      agent.inject(createUserMessage({
        source: { kind: 'plugin', plugin: 'dsh-qqchat', form: 'snapshot', sections: [{ name: 'qq-chat-context', text: contextText }] },
        content: [{ type: 'text', text: contextText }],
      }))

      const current = createUserMessage({
        source: {
          kind: 'qq-chat', botId: String(message.accountId), chatType: message.chatType,
          chatId: message.chatId, senderId: message.senderId,
          ...(message.senderName ? { senderName: message.senderName } : {}),
          messageId: message.messageId || '', mentioned: Boolean(message.mentioned),
          form: 'notice',
          summary: `QQ ${message.chatType === 'group' ? '群聊' : '私聊'}消息 · ${message.senderName || shortId(message.senderId)}`,
        },
        content: [{ type: 'text', text: this.memory.currentMessageText(message) }],
      })

      this.pending.set(String(sessionId), { text: '' })
      this.activeActors.set(String(sessionId), { chatType: message.chatType, senderId: message.senderId })
      try {
        agent.followup(current)
        await agent.whenIdle()
      } finally {
        this.activeActors.delete(String(sessionId))
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
    if (event.type === 'request/header') {
      const { config } = event.data.header
      if (config.provider && config.model) this.routes.set(id, { provider: config.provider, model: config.model })
    }
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
        this.ensureTitle(live.session, chatType, row)
        this.rememberRoute(chatType, row, live, sessionId)
        await this.ensureVisible(live)
        return { agent: live, sessionId }
      }
      const resumed = await this.tryResume(sessionId)
      if (resumed) {
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
    session.append('qqchat/message', event)
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
      content: [{ type: 'text', text: event.content }],
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

function visiblePromptText(message: QQNormalizedMessage): string {
  const body = message.quotedText ? `> ${message.quotedText}\n\n${message.text || '(空消息)'}` : message.text || '(空消息)'
  if (message.chatType !== 'group') return body
  const speaker = message.senderName || shortId(message.senderId)
  return `${speaker} · ${shortId(message.senderId)}\n${body}`
}

function extractText(content: readonly unknown[]): string {
  return content.filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}

function shortId(value: string): string { return value.length > 10 ? `…${value.slice(-10)}` : value }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
