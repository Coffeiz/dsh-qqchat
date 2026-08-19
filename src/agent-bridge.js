import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export class DshQQBridge {
  constructor(ctx, db, memory, config, logger = console) {
    this.ctx = ctx
    this.db = db
    this.memory = memory
    this.config = config
    this.logger = logger
    this.handles = new Map()
    this.locks = new Map()
    this.pending = new Map()
    this.routes = new Map()
    this.disposeEvent = ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
  }

  async dispose() {
    this.disposeEvent?.()
    for (const handle of this.handles.values()) {
      try { await handle.dispose() } catch {}
    }
    this.handles.clear()
  }

  async reply(message, group, member) {
    const key = message.chatType === 'group' ? `g:${group.id}` : `u:${member.id}`
    return this.serial(key, async () => {
      const { agent, sessionId } = await this.ensureAgent(message.chatType, message.chatType === 'group' ? group : member)
      await agent.whenIdle()
      const contextText = message.chatType === 'group'
        ? this.memory.contextForGroup(group, member)
        : this.memory.contextForMember(member)
      agent.inject(createUserMessage({
        source: { kind: 'plugin', plugin: 'dsh-qqchat', form: 'snapshot', sections: ['qq-chat-memory', 'qq-recent-history'] },
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
        this.memory.setRoute(Number(group.id), route.provider, route.model, String(sessionId))
      }
      const text = pending?.text?.trim()
      if (!text) throw new Error('DSH Agent 本轮没有产生可发送的文本回复')
      return text
    })
  }

  onSessionEvent(session, event) {
    const id = String(session.id)
    if (event.type === 'assistant/message') {
      const pending = this.pending.get(id)
      if (!pending) return
      const text = extractText(event.data?.message?.content)
      if (text.trim()) pending.text = text
      return
    }
    if (event.type === 'request/header') {
      const config = event.data?.header?.config
      if (config?.provider && config?.model) this.routes.set(id, { provider: config.provider, model: config.model })
    }
  }

  async ensureAgent(chatType, row) {
    let sessionId = this.db.getChatSession(chatType, Number(row.id))
    if (sessionId) {
      const live = this.ctx.agents.get?.(SessionId(sessionId))
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

  async tryResume(sessionId) {
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

  agentOptions() {
    const options = {}
    if (this.config.provider) options.provider = this.config.provider
    if (this.config.model) options.model = this.config.model
    if (this.config.maxTokens) options.maxTokens = this.config.maxTokens
    return options
  }

  async composition() {
    const presets = this.ctx.get?.('agentPresets')
    if (!presets) return { presetId: undefined, setup: undefined }
    const preset = await presets.resolve(this.config.agentPreset)
    return {
      presetId: preset.id,
      setup: agentCtx => presets.mount(agentCtx, preset.id),
    }
  }

  serial(key, task) {
    const previous = this.locks.get(key) || Promise.resolve()
    const current = previous.catch(() => {}).then(task)
    this.locks.set(key, current)
    return current.finally(() => {
      if (this.locks.get(key) === current) this.locks.delete(key)
    })
  }
}

function extractText(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('\n')
}
