import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import './dsh-augmentations.js'
import type { QQChatDatabase } from './db.js'
import type { MemoryEngine } from './memory.js'
import type {
  ChatType,
  GroupRow,
  LoggerLike,
  MemberRow,
  PendingReply,
  QQChatConfig,
  QQNormalizedMessage,
} from './types.js'

interface AgentPreset {
  id: string
}

interface AgentPresetService {
  resolve(id?: string): Promise<AgentPreset>
  mount(ctx: Context, id: string): Promise<unknown>
}

interface Composition {
  presetId?: string
  setup?: AgentSetup
}

export class DshQQBridge {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly pending = new Map<string, PendingReply>()
  private readonly routes = new Map<string, { provider: string; model: string }>()
  private readonly disposeEvent: () => void

  constructor(
    private readonly ctx: Context,
    private readonly db: QQChatDatabase,
    private readonly memory: MemoryEngine,
    private readonly config: QQChatConfig,
    private readonly logger: LoggerLike = console,
  ) {
    this.disposeEvent = ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
  }

  async dispose(): Promise<void> {
    this.disposeEvent()
    for (const handle of this.handles.values()) {
      try { await handle.dispose() } catch {}
    }
    this.handles.clear()
  }

  async reply(message: QQNormalizedMessage, group: GroupRow | undefined, member: MemberRow): Promise<string> {
    if (message.chatType === 'group' && !group) throw new Error('群消息缺少群上下文')
    const key = message.chatType === 'group' ? `g:${group!.id}` : `u:${member.id}`
    return this.serial(key, async () => {
      const row = message.chatType === 'group' ? group! : member
      const { agent, sessionId } = await this.ensureAgent(message.chatType, row)
      await agent.whenIdle()
      const contextText = message.chatType === 'group'
        ? this.memory.contextForGroup(group!, member)
        : this.memory.contextForMember(member)
      agent.inject(createUserMessage({
        source: {
          kind: 'plugin',
          plugin: 'dsh-qqchat',
          form: 'snapshot',
          sections: [{ name: 'qq-chat-context', text: contextText }],
        },
        content: [{ type: 'text', text: contextText }],
      }))
      const current = createUserMessage({
        source: {
          kind: 'qq-chat',
          botId: String(message.accountId),
          chatType: message.chatType,
          chatId: message.chatId,
          senderId: message.senderId,
          senderName: message.senderName || undefined,
          messageId: message.messageId || '',
          mentioned: Boolean(message.mentioned),
        },
        content: [{ type: 'text', text: this.memory.currentMessageText(message) }],
      })
      this.pending.set(String(sessionId), { text: '' })
      agent.followup(current)
      await agent.whenIdle()
      const pending = this.pending.get(String(sessionId))
      this.pending.delete(String(sessionId))
      const route = this.routes.get(String(sessionId)) || {
        provider: agent.options.provider,
        model: agent.options.model,
      }
      if (message.chatType === 'group' && route.provider && route.model) {
        this.memory.setRoute(Number(group!.id), route.provider, route.model, String(sessionId))
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
      const live = this.ctx.agents.get(SessionId(sessionId))
      if (live) return { agent: live, sessionId }
      const resumed = await this.tryResume(sessionId)
      if (resumed) return { agent: resumed.agent, sessionId }
    }
    sessionId = `qqchat-${randomUUID()}`
    const composition = await this.composition()
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: composition.presetId ? { agentPreset: composition.presetId } : undefined,
      agentOptions: this.agentOptions(),
      setup: composition.setup,
    })
    this.handles.set(sessionId, handle)
    this.db.setChatSession(chatType, Number(row.id), sessionId)
    return { agent: handle.agent, sessionId }
  }

  private async tryResume(sessionId: string): Promise<AgentHandle | undefined> {
    try {
      const composition = await this.composition()
      const handle = await this.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        agentOptions: this.agentOptions(),
        setup: composition.setup,
      })
      this.handles.set(sessionId, handle)
      return handle
    } catch (error) {
      this.logger.warn?.(`[dsh-qqchat] 无法恢复 QQ session ${sessionId}，将创建新 session: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  private agentOptions(): AgentOptions {
    const options: AgentOptions = {}
    if (this.config.provider) options.provider = this.config.provider
    if (this.config.model) options.model = this.config.model
    if (this.config.maxTokens) options.maxTokens = this.config.maxTokens
    return options
  }

  private async composition(): Promise<Composition> {
    const getService = (this.ctx as unknown as { get?: (name: string) => unknown }).get
    const presets = getService?.call(this.ctx, 'agentPresets') as AgentPresetService | undefined
    if (!presets) return {}
    const preset = await presets.resolve(this.config.agentPreset)
    return {
      presetId: preset.id,
      setup: async agentCtx => { await presets.mount(agentCtx, preset.id) },
    }
  }

  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) || Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.locks.set(key, current)
    return current.finally(() => {
      if (this.locks.get(key) === current) this.locks.delete(key)
    })
  }
}

function extractText(content: readonly unknown[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
