import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { QQChatDatabase } from './db.js'
import type {
  GroupMemberRow,
  GroupRow,
  LoggerLike,
  MemoryDocType,
  MemoryDocuments,
  MemoryView,
  ModelRoute,
  QQChatConfig,
  ReflectionPayload,
} from './types.js'

const DOCS = ['profile', 'summary', 'daily', 'memory', 'pattern'] as const satisfies readonly MemoryDocType[]

export class MemoryEngine {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly routes = new Map<number, ModelRoute>()

  constructor(
    private readonly ctx: Context,
    private readonly db: QQChatDatabase,
    private readonly config: QQChatConfig,
    private readonly logger: LoggerLike = console,
  ) {}

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  setRoute(groupId: number, provider: string, model: string, sessionId: string): void {
    if (!provider || !model) return
    this.routes.set(Number(groupId), { provider, model, sessionId })
  }

  schedule(groupId: number): void {
    groupId = Number(groupId)
    if (!this.routes.has(groupId)) return
    const existing = this.timers.get(groupId)
    if (existing) clearTimeout(existing)
    if (this.db.unreflectedCount(groupId) >= this.config.reflectionBatchSize) {
      void this.reflectNow(groupId).catch(error => this.logger.warn?.(`[dsh-qqchat] memory reflection: ${errorMessage(error)}`))
      return
    }
    const timer = setTimeout(() => {
      this.timers.delete(groupId)
      void this.reflectNow(groupId).catch(error => this.logger.warn?.(`[dsh-qqchat] memory reflection: ${errorMessage(error)}`))
    }, this.config.reflectionIdleMs)
    timer.unref?.()
    this.timers.set(groupId, timer)
  }

  async reflectNow(groupId: number): Promise<MemoryView> {
    groupId = Number(groupId)
    const route = this.routes.get(groupId)
    if (!route) throw new Error('这个群还没有可复用的 DSH 模型路由；先让 Agent 在群里完成一次回复')
    const group = this.db.groupById(groupId)
    if (!group) throw new Error('群不存在')
    const messages = this.db.unreflectedMessages(groupId, this.config.reflectionMaxMessages)
    if (messages.length === 0) {
      const view = this.memoryView(groupId)
      if (!view) throw new Error('群不存在')
      return view
    }

    const members = this.db.listGroupMembers(groupId)
    const currentGroup = this.db.memoryDocs('group', groupId)
    const memberMemory = Object.fromEntries(
      members.map(member => [member.platform_user_id, this.db.memoryDocs('member', Number(member.id))]),
    )
    const transcript = messages.map(message => ({
      id: Number(message.id),
      at: message.created_at,
      direction: message.direction,
      senderId: message.direction === 'outbound' ? 'BOT' : message.platform_user_id,
      senderName: message.direction === 'outbound' ? 'DSH Agent' : (message.display_name || ''),
      text: message.content,
      quotedText: message.quoted_text || '',
    }))

    const input = {
      group: { id: group.platform_group_id, name: group.name || '' },
      existing: { group: pickDocs(currentGroup), members: memberMemory },
      messages: transcript,
    }
    const system = memorySystemPrompt()
    const request = createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-qqchat' },
      content: [{ type: 'text', text: JSON.stringify(input) }],
    })
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      messages: [request],
      system,
      maxTokens: this.config.memoryMaxTokens,
      sessionId: SessionId(route.sessionId || `qqchat-memory-${groupId}`),
    })) assembler.push(chunk)
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const reflected = parseJsonObject(text)
    this.applyReflection(groupId, members, reflected)
    const lastMessage = messages.at(-1)
    if (lastMessage) this.db.markReflected(groupId, Number(lastMessage.id))
    const view = this.memoryView(groupId)
    if (!view) throw new Error('群不存在')
    return view
  }

  private applyReflection(groupId: number, members: GroupMemberRow[], reflected: ReflectionPayload): void {
    const group = reflected.group || {}
    if (group.profile !== undefined) this.db.setMemoryDoc('group', groupId, 'profile', stringifyDoc(group.profile))
    if (group.summary !== undefined) this.db.setMemoryDoc('group', groupId, 'summary', stringifyDoc(group.summary))
    if (group.memory !== undefined) this.db.setMemoryDoc('group', groupId, 'memory', stringifyMemory(group.memory))
    if (group.daily !== undefined && stringifyDoc(group.daily).trim()) {
      const stamp = new Date().toISOString().slice(0, 10)
      this.db.appendMemoryDoc('group', groupId, 'daily', `\n## ${stamp}\n${stringifyDoc(group.daily)}`)
    }
    const byOpenid = new Map(members.map(member => [member.platform_user_id, Number(member.id)]))
    const updates = Array.isArray(reflected.members) ? reflected.members : []
    for (const update of updates) {
      const memberId = byOpenid.get(String(update.senderId || ''))
      if (!memberId) continue
      if (update.profile !== undefined) this.db.setMemoryDoc('member', memberId, 'profile', stringifyDoc(update.profile))
      if (update.pattern !== undefined) this.db.setMemoryDoc('member', memberId, 'pattern', stringifyDoc(update.pattern))
      if (update.summary !== undefined) this.db.setMemoryDoc('member', memberId, 'summary', stringifyDoc(update.summary))
    }
  }

  contextForGroup(
    group: GroupRow,
    currentMember?: { id: number; platform_user_id: string; display_name: string | null },
    currentPlatformMessageId?: string,
  ): string {
    const history = this.db.recentGroupMessages(Number(group.id), this.config.recentGroupMessages)
      .filter(message => !currentPlatformMessageId || message.platform_message_id !== currentPlatformMessageId)
    const groupDocs = this.db.memoryDocs('group', Number(group.id))
    const memberDocs = currentMember ? this.db.memoryDocs('member', Number(currentMember.id)) : {}
    const lines = history.map(message => {
      const when = new Date(Number(message.created_at)).toISOString()
      if (message.direction === 'outbound') return `${when} | 发言人ID=BOT | 显示名=DSH Agent | ${message.content}`
      return `${when} | 发言人ID=${message.platform_user_id || 'unknown'} | 显示名=${message.display_name || ''} | ${message.content}`
    })
    return [
      '[QQ 群聊上下文快照]',
      '以下 sender ID / group ID 是可靠平台元数据。不要根据昵称猜身份，不要把其他群成员的兴趣、关系或记忆归到当前发言人。',
      `群ID=${group.platform_group_id}`,
      group.name ? `群名=${group.name}` : '',
      section('群画像', groupDocs.profile),
      section('群摘要', groupDocs.summary),
      section('群长期记忆', groupDocs.memory),
      section('群最近沉淀', groupDocs.daily),
      currentMember ? `当前成员ID=${currentMember.platform_user_id}\n当前成员显示名=${currentMember.display_name || ''}` : '',
      section('当前成员画像', memberDocs.profile),
      section('当前成员模式', memberDocs.pattern),
      section('当前成员摘要', memberDocs.summary),
      '[最近群聊记录；每行身份元数据可靠；不包含当前待回复消息]',
      ...lines,
    ].filter(Boolean).join('\n')
  }

  contextForMember(member: { id: number; platform_user_id: string; display_name: string | null }): string {
    const docs = this.db.memoryDocs('member', Number(member.id))
    return [
      '[QQ 私聊成员上下文]',
      `成员ID=${member.platform_user_id}`,
      `显示名=${member.display_name || ''}`,
      '成员ID 是可靠平台身份；昵称仅供展示。',
      section('成员画像', docs.profile),
      section('行为模式', docs.pattern),
      section('成员摘要', docs.summary),
    ].filter(Boolean).join('\n')
  }

  memoryView(groupId: number): MemoryView | undefined {
    const group = this.db.groupById(Number(groupId))
    if (!group) return undefined
    const members = this.db.listGroupMembers(Number(groupId)).map(member => ({
      ...member,
      memory: this.db.memoryDocs('member', Number(member.id)),
    }))
    return { group, groupMemory: this.db.memoryDocs('group', Number(groupId)), members }
  }
}

function memorySystemPrompt(): string {
  return `你负责整理一个 QQ 群的长期记忆。目标是稳定、克制、可追溯地维护群 scope 与成员 scope，规则：
1. senderId 是唯一可靠身份，不根据昵称猜身份；不同 senderId 的个人事实绝不能混写。
2. 群 scope 只写群级角色、关系、共同决定、长期话题、群内约定；个人稳定信息写到对应 member。
3. 不把一次性寒暄、玩笑、临时情绪上升为长期事实；不确定信息宁可不记。
4. existing 是已有记忆，应在其基础上更新，而不是无条件推翻。
5. daily 只写本批消息值得留档的新进展；memory 保留真正长期有用的项目、关系、约定和背景。
6. 输出严格 JSON，不要 Markdown 代码块、解释或额外文字。
输出结构：
{"group":{"profile":{},"summary":"","daily":"","memory":["..."]},"members":[{"senderId":"可靠ID","profile":{},"pattern":{},"summary":""}]}
没有变化的成员可省略；不要为 BOT 创建成员记忆。`
}

function parseJsonObject(text: string): ReflectionPayload {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) as ReflectionPayload } catch {}
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as ReflectionPayload
  throw new Error('记忆反思模型没有返回有效 JSON')
}

function stringifyDoc(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}

function stringifyMemory(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')
  }
  return stringifyDoc(value)
}

function pickDocs(docs: MemoryDocuments): MemoryDocuments {
  return Object.fromEntries(DOCS.filter(key => docs[key]).map(key => [key, docs[key]])) as MemoryDocuments
}

function section(title: string, content: string | undefined): string {
  return content ? `[${title}]\n${content}` : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
