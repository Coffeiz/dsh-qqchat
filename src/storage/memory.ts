import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { QQChatDatabase } from './db.js'
import type {
  GroupMemberRow,
  GroupRow,
  LoggerLike,
  MemberRow,
  MemoryDocType,
  MemoryDocuments,
  MemoryView,
  MessageRow,
  ModelRoute,
  QQChatConfig,
  DailyEntry,
  ReflectionPayload,
  ProfileEntry,
  ProfileEntryType,
  QQNormalizedMessage,
} from '../types.js'

const DOCS = ['profile', 'summary', 'daily', 'memory', 'pattern'] as const satisfies readonly MemoryDocType[]

interface MemberReflectionPayload {
  profile?: unknown
  pattern?: unknown
  summary?: unknown
  memory?: unknown
  daily?: unknown
}

const MEMBER_DAILY_COMPACT_AT = 100
const MEMBER_DAILY_KEEP_RECENT = 50
const GROUP_DAILY_COMPACT_AT = 1000
const GROUP_DAILY_KEEP_RECENT = 500

export class MemoryEngine {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly memberTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly routes = new Map<number, ModelRoute>()
  private readonly memberRoutes = new Map<number, ModelRoute>()
  private readonly reflectingGroups = new Map<number, Promise<MemoryView>>()
  private readonly reflectingMembers = new Map<number, Promise<MemoryDocuments>>()

  constructor(
    private readonly ctx: Context,
    private readonly db: QQChatDatabase,
    private readonly config: QQChatConfig,
    private readonly logger: LoggerLike = console,
  ) {}

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    for (const timer of this.memberTimers.values()) clearTimeout(timer)
    this.timers.clear()
    this.memberTimers.clear()
    this.reflectingGroups.clear()
    this.reflectingMembers.clear()
  }

  setRoute(groupId: number, provider: string, model: string, sessionId: string): void {
    if (!provider || !model) return
    this.routes.set(Number(groupId), { provider, model, sessionId })
  }

  setMemberRoute(memberId: number, provider: string, model: string, sessionId: string): void {
    if (!provider || !model) return
    this.memberRoutes.set(Number(memberId), { provider, model, sessionId })
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

  scheduleMember(memberId: number): void {
    memberId = Number(memberId)
    if (!this.memberRoutes.has(memberId)) return
    const existing = this.memberTimers.get(memberId)
    if (existing) clearTimeout(existing)
    if (this.unreflectedDirectMessages(memberId, this.config.reflectionBatchSize).length >= this.config.reflectionBatchSize) {
      void this.reflectMemberNow(memberId).catch(error => this.logger.warn?.(`[dsh-qqchat] member memory reflection: ${errorMessage(error)}`))
      return
    }
    const timer = setTimeout(() => {
      this.memberTimers.delete(memberId)
      void this.reflectMemberNow(memberId).catch(error => this.logger.warn?.(`[dsh-qqchat] member memory reflection: ${errorMessage(error)}`))
    }, this.config.reflectionIdleMs)
    timer.unref?.()
    this.memberTimers.set(memberId, timer)
  }

  async reflectNow(groupId: number): Promise<MemoryView> {
    groupId = Number(groupId)
    const existing = this.reflectingGroups.get(groupId)
    if (existing) return existing
    const current = this.reflectNowInternal(groupId)
    this.reflectingGroups.set(groupId, current)
    return current.finally(() => {
      if (this.reflectingGroups.get(groupId) === current) this.reflectingGroups.delete(groupId)
    })
  }

  private async reflectNowInternal(groupId: number): Promise<MemoryView> {
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
      members.map(member => [member.platform_user_id, {
        profile: this.db.memoryDocs('member', Number(member.id)).profile || '',
        pattern: this.db.memoryDocs('member', Number(member.id)).pattern || '',
        summary: this.db.memoryDocs('member', Number(member.id)).summary || '',
        memory: this.db.memoryDocs('member', Number(member.id)).memory || '',
        name: member.display_name || '',
        aliases: parseStringList(member.aliases_json),
        nicknames: parseStringList(member.nicknames_json),
      }]),
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
    const reflected = await this.generateReflection(route, memorySystemPrompt(), input, `qqchat-memory-${groupId}`) as ReflectionPayload
    this.applyReflection(groupId, members, reflected)
    await this.compactDaily('group', groupId, route, GROUP_DAILY_COMPACT_AT, GROUP_DAILY_KEEP_RECENT, `qqchat-group-compress-${groupId}`)
    const lastMessage = messages.at(-1)
    if (lastMessage) this.db.markReflected(groupId, Number(lastMessage.id))
    const view = this.memoryView(groupId)
    if (!view) throw new Error('群不存在')
    return view
  }

  async reflectMemberNow(memberId: number): Promise<MemoryDocuments> {
    memberId = Number(memberId)
    const existing = this.reflectingMembers.get(memberId)
    if (existing) return existing
    const current = this.reflectMemberNowInternal(memberId)
    this.reflectingMembers.set(memberId, current)
    return current.finally(() => {
      if (this.reflectingMembers.get(memberId) === current) this.reflectingMembers.delete(memberId)
    })
  }

  private async reflectMemberNowInternal(memberId: number): Promise<MemoryDocuments> {
    memberId = Number(memberId)
    const route = this.memberRoutes.get(memberId)
    if (!route) throw new Error('这个私聊还没有可复用的 DSH 模型路由；先让 Agent 完成一次回复')
    const member = this.db.memberById(memberId)
    if (!member) throw new Error('成员不存在')
    const messages = this.unreflectedDirectMessages(memberId, this.config.reflectionMaxMessages)
    if (messages.length === 0) return this.db.memoryDocs('member', memberId)

    const input = {
      member: {
        senderId: member.platform_user_id,
        displayName: member.display_name || '',
      },
      existing: pickMemberDocs(this.db.memoryDocs('member', memberId)),
      messages: messages.map(message => ({
        id: Number(message.id),
        at: message.created_at,
        direction: message.direction,
        senderId: message.direction === 'outbound' ? 'BOT' : member.platform_user_id,
        senderName: message.direction === 'outbound' ? 'DSH Agent' : (member.display_name || ''),
        text: message.content,
        quotedText: message.quoted_text || '',
      })),
    }
    const reflected = await this.generateReflection(route, memberMemorySystemPrompt(), input, `qqchat-member-memory-${memberId}`) as MemberReflectionPayload
    if (reflected.profile !== undefined) this.db.setMemoryDoc('member', memberId, 'profile', stringifyProfile(reflected.profile))
    if (reflected.pattern !== undefined) this.db.setMemoryDoc('member', memberId, 'pattern', stringifyDoc(reflected.pattern))
    if (reflected.summary !== undefined) this.db.setMemoryDoc('member', memberId, 'summary', stringifyDoc(reflected.summary))
    if (reflected.memory !== undefined) this.db.setMemoryDoc('member', memberId, 'memory', stringifyMemory(reflected.memory))
    if (reflected.daily !== undefined) {
      const last = messages.at(-1)
      this.db.appendDailyDoc('member', memberId, dateForTimestamp(last?.created_at), stringifyDoc(reflected.daily))
    }
    await this.compactDaily('member', memberId, route, MEMBER_DAILY_COMPACT_AT, MEMBER_DAILY_KEEP_RECENT, `qqchat-member-compress-${memberId}`)
    const lastMessage = messages.at(-1)
    if (lastMessage) this.db.setSetting(memberCursorKey(memberId), Number(lastMessage.id))
    return this.db.memoryDocs('member', memberId)
  }

  private async compactDaily(
    scopeType: 'group' | 'member',
    scopeKey: number,
    route: ModelRoute,
    threshold: number,
    keepRecent: number,
    fallbackSessionId: string,
  ): Promise<boolean> {
    const entries = this.db.dailyEntries(scopeType, scopeKey)
    if (entries.length < threshold) return false
    const overflow = entries.slice(0, -keepRecent)
    const recent = entries.slice(-keepRecent)
    if (!overflow.length) return false
    const existingMemory = this.db.memoryDocs(scopeType, scopeKey).memory || ''
    const profile = this.db.memoryDocs(scopeType === 'member' ? 'member' : 'group', scopeKey).profile || ''
    const pattern = this.db.memoryDocs('member', scopeKey).pattern || ''
    const system = scopeType === 'group' ? groupCompressionSystemPrompt() : memberCompressionSystemPrompt()
    const input = scopeType === 'group'
      ? `已有长期记忆：\n${existingMemory || '（暂无）'}\n\n近期群聊记录（按日期保留历史，不要丢日期）：\n${renderDailyEntries(overflow)}\n\n请输出整理后的完整长期记忆主档。`
      : `已有长期记忆：\n${existingMemory || '（暂无）'}\n\n结构化 profile：\n${profile || '（暂无）'}\n\n行为模式：\n${pattern || '（暂无）'}\n\n要沉淀的近期记录（按日期保留历史，不要丢日期）：\n${renderDailyEntries(overflow)}\n\n请输出整理后的完整长期记忆主档。`
    try {
      const result = await this.generateReflection(route, system, { text: input }, fallbackSessionId, this.config.memoryCompressionMaxTokens) as { memory?: unknown }
      const memory = typeof result?.memory === 'string' ? result.memory.trim() : ''
      if (!memory || !preservesDailyDates(overflow, memory)) return false
      this.db.setMemoryDoc(scopeType, scopeKey, 'memory', memory)
      this.db.setDailyEntries(scopeType, scopeKey, recent)
      return true
    } catch (error) {
      this.logger.warn?.(`[dsh-qqchat] ${scopeType} memory compression skipped: ${errorMessage(error)}`)
      return false
    }
  }

  private async generateReflection(route: ModelRoute, system: string, input: unknown, fallbackSessionId: string, maxTokens = this.config.memoryMaxTokens): Promise<unknown> {
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
      maxTokens,
      sessionId: SessionId(route.sessionId || fallbackSessionId),
    })) assembler.push(chunk)
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    return parseJsonObject(text)
  }

  private unreflectedDirectMessages(memberId: number, limit: number): MessageRow[] {
    const cursor = this.db.getSetting<number>(memberCursorKey(memberId), 0)
    const fetchLimit = Math.max(limit, this.config.reflectionMaxMessages)
    return this.db.listDirectMessages(memberId, fetchLimit)
      .filter(message => Number(message.id) > cursor)
      .slice(-limit)
  }

  private applyReflection(groupId: number, members: GroupMemberRow[], reflected: ReflectionPayload): void {
    const group = reflected.group || {}
    if (group.profile !== undefined) this.db.setMemoryDoc('group', groupId, 'profile', stringifyDoc(group.profile))
    if (group.summary !== undefined) this.db.setMemoryDoc('group', groupId, 'summary', stringifyDoc(group.summary))
    if (group.memory !== undefined) this.db.setMemoryDoc('group', groupId, 'memory', stringifyMemory(group.memory))
    if (group.daily !== undefined && stringifyDoc(group.daily).trim()) {
      const stamp = new Date().toISOString().slice(0, 10)
      this.db.appendDailyDoc('group', groupId, stamp, stringifyDoc(group.daily))
    }
    const byOpenid = new Map(members.map(member => [member.platform_user_id, Number(member.id)]))
    const updates = Array.isArray(reflected.members) ? reflected.members : []
    for (const update of updates) {
      const memberId = byOpenid.get(String(update.senderId || ''))
      if (!memberId) continue
      if (update.profile !== undefined) this.db.setMemoryDoc('member', memberId, 'profile', stringifyProfile(update.profile))
      if (update.pattern !== undefined) this.db.setMemoryDoc('member', memberId, 'pattern', stringifyDoc(update.pattern))
      if (update.summary !== undefined) this.db.setMemoryDoc('member', memberId, 'summary', stringifyDoc(update.summary))
      if (update.memory !== undefined) this.db.setMemoryDoc('member', memberId, 'memory', stringifyMemory(update.memory))
      if (Array.isArray(update.nicknames)) {
        for (const nickname of update.nicknames) {
          if (typeof nickname === 'string') this.db.addGroupMemberNickname(groupId, memberId, nickname)
        }
      }
    }
  }

  contextForGroup(
    group: GroupRow,
    currentMember?: { id: number; platform_user_id: string; display_name: string | null },
  ): string {
    const groupDocs = this.db.memoryDocs('group', Number(group.id))
    const memberDocs = currentMember ? this.db.memoryDocs('member', Number(currentMember.id)) : {}
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
      section('当前成员长期记忆', memberDocs.memory),
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
      section('成员近期沉淀', docs.daily),
      section('成员长期记忆', docs.memory),
    ].filter(Boolean).join('\n')
  }

  currentMessageText(message: QQNormalizedMessage): string {
    return [
      message.chatType === 'group' ? '[当前 QQ 群消息；以下身份字段是可靠元数据]' : '[当前 QQ 私聊消息；以下身份字段是可靠元数据]',
      `发言人ID=${message.senderId}`,
      `显示名=${message.senderName || ''}`,
      message.chatType === 'group' ? `群ID=${message.groupOpenid || ''}` : '',
      `是否@机器人=${message.mentioned ? '是' : '否'}`,
      message.quotedText ? `引用=${message.quotedText}` : '',
      '正文：',
      message.text || '(空消息)',
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
1. senderId 是唯一可靠身份，不根据昵称猜身份；不同 senderId 的个人事实绝不能混写。成员记录中的 name/aliases/nicknames 只用于称呼和检索。
2. 群 scope 只写群级角色、关系、共同决定、长期话题、群内约定；个人稳定信息写到对应 member。
3. 不把一次性寒暄、玩笑、临时情绪上升为长期事实；不确定信息宁可不记。
4. existing 是已有记忆，应在其基础上更新，而不是无条件推翻。
5. daily 只写本批消息值得留档的新进展；memory 保留真正长期有用的项目、关系、约定和背景。
6. 输出严格 JSON，不要 Markdown 代码块、解释或额外文字。
输出结构：
{"group":{"profile":{},"summary":"","daily":"","memory":["..."]},"members":[{"senderId":"可靠ID","profile":[{"type":"name|address|pronoun|background|preference|note","text":"...","ts":0}],"pattern":{},"summary":"","memory":"","nicknames":["群内称呼"]}]}
没有变化的成员可省略；不要为 BOT 创建成员记忆。`
}

function memberMemorySystemPrompt(): string {
  return `你负责整理一个 QQ 私聊成员的长期记忆。senderId 是唯一可靠身份，displayName 只用于展示。规则：
1. 只记录这个成员稳定且未来有用的信息，不根据昵称猜身份。
2. profile 写较稳定的个人事实，必须输出带 type/text/ts 的条目；type 只能是 name、address、pronoun、background、preference、note。pattern 写多次出现的偏好、习惯或行为模式；summary 写当前值得保留的紧凑状态；memory 写长期项目、关系、约定和背景。
3. 一次性寒暄、玩笑、短暂情绪和未经确认的推断不要写入长期记忆。
4. existing 是已有记忆，应在其基础上克制更新。
5. 输出严格 JSON，不要 Markdown 代码块、解释或额外文字。
输出结构：{"profile":[{"type":"name|address|pronoun|background|preference|note","text":"...","ts":0}],"pattern":{},"summary":"","memory":"","daily":""}`
}

function groupCompressionSystemPrompt(): string {
  return `你负责维护 QQ 群长期记忆主档。把近期 daily 记录合并进已有 memory，合并重复、修正矛盾，但保留有价值的历史、日期、事件背景和变化过程；不要因为旧或细而删除历史，不评判、不推测。严格只输出 JSON：{"memory":"更新后的长期记忆全文；不能清空"}`
}

function memberCompressionSystemPrompt(): string {
  return `你负责维护 QQ 成员长期记忆主档。把近期 daily 记录合并进已有 memory，结合 profile 和 pattern，保留有价值的历史、日期、项目背景和变化过程；不要重复抄写 profile/pattern，不评判、不推测，不能清空已有长期记忆。严格只输出 JSON：{"memory":"更新后的长期记忆全文；不能清空"}`
}

function renderDailyEntries(entries: DailyEntry[]): string {
  const out: string[] = []
  let current = ''
  for (const entry of entries) {
    if (!entry.date || !entry.note) continue
    if (entry.date !== current) {
      if (out.length) out.push('')
      out.push(`## ${entry.date}`)
      current = entry.date
    }
    out.push(`- ${entry.note}`)
  }
  return out.join('\n')
}

function preservesDailyDates(entries: DailyEntry[], memory: string): boolean {
  return [...new Set(entries.map(entry => entry.date))].every(date => memory.includes(date))
}

function dateForTimestamp(value: number | null | undefined): string {
  return new Date(Number(value || Date.now())).toISOString().slice(0, 10)
}

export function parseJsonObject(text: string): ReflectionPayload | MemberReflectionPayload {
  const trimmed = String(text || '').trim()
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  for (const candidate of [trimmed, unfenced]) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ReflectionPayload | MemberReflectionPayload
    } catch {}
  }

  // Models sometimes add a short explanation before/after the JSON. Find a
  // balanced object while respecting quoted strings and escaped characters.
  for (let start = unfenced.indexOf('{'); start >= 0; start = unfenced.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < unfenced.length; index += 1) {
      const char = unfenced[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            const parsed = JSON.parse(unfenced.slice(start, index + 1)) as unknown
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ReflectionPayload | MemberReflectionPayload
          } catch {}
          break
        }
      }
    }
  }
  throw new Error('记忆反思模型没有返回有效 JSON')
}

function stringifyDoc(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}

function stringifyProfile(value: unknown): string {
  const entries = normalizeProfileEntries(value)
  return JSON.stringify(entries, null, 2)
}

function normalizeProfileEntries(value: unknown): ProfileEntry[] {
  let input = value
  if (typeof input === 'string') {
    try { input = JSON.parse(input) } catch { input = { note: input } }
  }
  const now = Date.now()
  if (Array.isArray(input)) {
    return input.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const raw = item as Record<string, unknown>
      const text = typeof raw.text === 'string' ? raw.text.trim() : ''
      if (!text) return []
      const type = profileType(raw.type)
      return [{ type, text, ts: Number.isSafeInteger(raw.ts) ? Number(raw.ts) : now }]
    })
  }
  if (input && typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).flatMap(([key, raw]) => {
      const text = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw)
      return text ? [{ type: profileType(key), text, ts: now }] : []
    })
  }
  return typeof input === 'string' && input.trim() ? [{ type: 'note', text: input.trim(), ts: now }] : []
}

function profileType(value: unknown): ProfileEntryType {
  const type = String(value || '').trim()
  if (type === 'name' || type === 'name_observed' || type === 'display_name' || type === 'nickname') return 'name'
  if (type === 'address' || type === 'pronoun' || type === 'background' || type === 'dev_env' || type === 'preference') return type === 'dev_env' ? 'background' : type
  return 'note'
}

function parseStringList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : []
  } catch {
    return []
  }
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

function pickMemberDocs(docs: MemoryDocuments): MemoryDocuments {
  return {
    ...(docs.profile ? { profile: docs.profile } : {}),
    ...(docs.pattern ? { pattern: docs.pattern } : {}),
    ...(docs.summary ? { summary: docs.summary } : {}),
    ...(docs.memory ? { memory: docs.memory } : {}),
  }
}

function memberCursorKey(memberId: number): string {
  return `memberReflection:${memberId}`
}

function section(title: string, content: string | undefined): string {
  return content ? `[${title}]\n${content}` : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
