import type { Context } from '@deepseek-ai/cordis'
import type { DshQQBridge } from './agent-bridge.js'
import { defaultRuntimeSettings } from './config.js'
import type { QQChatDatabase } from './db.js'
import type { QQChatLogger } from './logging.js'
import type { MemoryEngine } from './memory.js'
import type { QQApiClient } from './qq-api.js'
import type { QQBindService } from './qq-auth.js'
import { QQGateway } from './qq-gateway.js'
import { renderQQMentionNames } from './normalize.js'
import type {
  AccountRow, ChatTargetRow, ChatType, GroupReceiveMode, GroupRow, MemberRow, QQChatConfig,
  QQChatDisplayEvent, QQChatRuntimeSettings, QQChatRuntimeSettingsPatch, QQNormalizedMessage, ReplyFormat,
} from './types.js'

export class QQChatRuntime {
  readonly gateways = new Map<number, QQGateway>()
  private outboxTimer?: ReturnType<typeof setInterval>

  constructor(
    readonly ctx: Context, readonly db: QQChatDatabase, readonly api: QQApiClient,
    readonly auth: QQBindService, readonly memory: MemoryEngine, readonly bridge: DshQQBridge,
    readonly config: QQChatConfig, readonly logger: QQChatLogger,
  ) {}

  async start(): Promise<void> {
    for (const account of this.db.enabledAccounts()) this.startGateway(account)
    this.outboxTimer = setInterval(() => void this.flushOutbox(), 3000)
    this.outboxTimer.unref?.()
    this.logger.info?.('[dsh-qqchat] runtime started')
  }

  async stop(): Promise<void> {
    if (this.outboxTimer) clearInterval(this.outboxTimer)
    this.outboxTimer = undefined
    await Promise.all([...this.gateways.values()].map(gateway => gateway.stop().catch(() => undefined)))
    this.gateways.clear()
    await this.bridge.dispose()
    this.memory.dispose()
    this.db.close()
  }

  settings(): QQChatRuntimeSettings { return this.db.runtimeSettings(defaultRuntimeSettings(this.config)) }

  updateSettings(patch: QQChatRuntimeSettingsPatch): QQChatRuntimeSettings {
    if (patch.groupReceiveMode !== undefined) {
      if (!isGroupReceiveMode(patch.groupReceiveMode)) throw new Error('无效的群聊接收模式')
      this.db.setSetting('groupReceiveMode', patch.groupReceiveMode)
    }
    if (patch.groupReplyFormat !== undefined) {
      if (!isReplyFormat(patch.groupReplyFormat)) throw new Error('无效的群聊消息兼容格式')
      this.db.setSetting('groupReplyFormat', patch.groupReplyFormat)
    }
    if (patch.directReplyFormat !== undefined) {
      if (!isReplyFormat(patch.directReplyFormat)) throw new Error('无效的私聊消息兼容格式')
      this.db.setSetting('directReplyFormat', patch.directReplyFormat)
    }
    if (patch.groupMembersCanUseTools !== undefined) this.db.setSetting('groupMembersCanUseTools', Boolean(patch.groupMembersCanUseTools))
    if (patch.ownerUserId !== undefined) this.db.setSetting('ownerUserId', String(patch.ownerUserId).trim())
    const next = this.settings()
    this.logger.info?.('[dsh-qqchat] settings updated', next)
    return next
  }

  listChats(): ChatTargetRow[] {
    const groups: ChatTargetRow[] = this.db.listGroups().map(row => ({
      chatType: 'group', rowId: Number(row.id), accountId: Number(row.account_id), platformId: row.platform_group_id,
      displayName: row.name || `QQ群 ${shortId(row.platform_group_id)}`, dshSessionId: row.dsh_session_id || null,
      lastMessageAt: row.last_message_at ? Number(row.last_message_at) : null, messageCount: Number(row.message_count || 0),
    }))
    const directs: ChatTargetRow[] = this.db.listDirectChats().map(row => ({
      chatType: 'c2c', rowId: Number(row.id), accountId: Number(row.account_id), platformId: row.platform_user_id,
      displayName: row.display_name || `QQ 用户 ${shortId(row.platform_user_id)}`, dshSessionId: row.dsh_session_id || null,
      lastMessageAt: row.last_message_at ? Number(row.last_message_at) : null, messageCount: Number(row.message_count || 0),
    }))
    return [...groups, ...directs].sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  }

  async ensureChatSession(chatType: ChatType, rowId: number): Promise<string> {
    const row = this.chatRow(chatType, rowId)
    if (!row) throw new Error(chatType === 'group' ? '群不存在' : '私聊用户不存在')
    return this.bridge.ensureChatSession(chatType, row)
  }

  async sendActive(chatType: ChatType, rowId: number, content: string): Promise<string> {
    const text = content.trim()
    if (!text) throw new Error('消息不能为空')
    const row = this.chatRow(chatType, rowId)
    if (!row) throw new Error(chatType === 'group' ? '群不存在' : '私聊用户不存在')
    const account = this.db.accountById(Number(row.account_id))
    if (!account) throw new Error('QQ 账号不存在')
    const targetId = chatType === 'group' ? (row as GroupRow).platform_group_id : (row as MemberRow).platform_user_id
    const settings = this.settings()
    await this.api.sendText(account, targetId, text, { group: chatType === 'group', messageId: null, format: chatType === 'group' ? settings.groupReplyFormat : settings.directReplyFormat })
    const messageDbId = this.db.insertMessage({
      accountId: Number(account.id), chatType, groupId: chatType === 'group' ? Number(row.id) : undefined,
      memberId: chatType === 'c2c' ? Number(row.id) : undefined, direction: 'outbound', content: text,
    })
    const sessionId = await this.bridge.recordTranscript({
      messageId: `db:${messageDbId}`, chatType, chatId: targetId, direction: 'outbound', senderId: 'OWNER', senderName: 'Owner',
      content: text, quotedText: '', mentioned: false, createdAt: Date.now(),
    }, row, true)
    if (chatType === 'group') this.memory.schedule(Number(row.id))
    else this.memory.scheduleMember(Number(row.id))
    this.logger.info?.(`[dsh-qqchat] active ${chatType} message sent to ${shortId(targetId)}`)
    if (!sessionId) throw new Error('未能建立 QQ Chat DSH session')
    return sessionId
  }

  startGateway(account: AccountRow | undefined): void {
    if (!account) return
    const id = Number(account.id)
    if (this.gateways.has(id)) return
    const gateway = new QQGateway(account, this.db, this.api, message => this.onIncoming(message), this.logger)
    this.gateways.set(id, gateway)
    gateway.start()
  }

  async restartGateway(accountId: number): Promise<void> {
    const existing = this.gateways.get(Number(accountId))
    if (existing) await existing.stop()
    this.gateways.delete(Number(accountId))
    const account = this.db.accountById(Number(accountId))
    if (account?.enabled) this.startGateway(account)
  }

  private async onIncoming(message: QQNormalizedMessage): Promise<void> {
    const account = this.db.accountById(message.accountId)
    if (!account || !account.enabled) return
    const member = this.db.upsertMember(message.accountId, message.senderId, message.senderName)
    let group: GroupRow | undefined
    let shouldReply = true
    const settings = this.settings()
    if (message.chatType === 'group') {
      if (!message.groupOpenid) return
      const mode = settings.groupReceiveMode
      group = this.db.upsertGroup(message.accountId, message.groupOpenid, { enabled: true, requiresAt: mode === 'mention', readEnabled: true })
      this.db.touchGroupMember(Number(group.id), Number(member.id), message.senderName)
      shouldReply = mode === 'auto' || (mode === 'mention' && message.mentioned)
    }
    message.text = renderQQMentionNames(message.text, message.raw, id => {
      const mentionedMember = this.db.memberByPlatform(message.accountId, id)
      return mentionedMember?.display_name || undefined
    })

    const messageDbId = this.db.insertMessage({
      accountId: message.accountId, platformMessageId: message.messageId, chatType: message.chatType, groupId: group?.id,
      memberId: member.id, direction: 'inbound', content: message.text, quotedText: message.quotedText,
      mentioned: message.mentioned, raw: message.raw,
    })
    const row = message.chatType === 'group' ? group! : member
    const displayEvent: QQChatDisplayEvent = {
      messageId: `db:${messageDbId}`, chatType: message.chatType,
      chatId: message.chatType === 'group' ? message.groupOpenid! : message.senderId,
      direction: 'inbound', senderId: message.senderId, senderName: message.senderName || 'QQ 用户',
      isOwner: message.chatType === 'c2c'
        || (settings.ownerUserId !== '' && message.senderId === settings.ownerUserId),
      content: message.text,
      quotedText: message.quotedText, mentioned: message.mentioned, createdAt: Date.now(),
    }
    if (group) this.memory.schedule(Number(group.id))
    else this.memory.scheduleMember(Number(member.id))

    if (!shouldReply) {
      await this.bridge.recordTranscript(displayEvent, row, true)
      if (group) this.memory.schedule(Number(group.id))
      return
    }

    try {
      // Keep the incoming QQ message visible in Web independently from the
      // notice-shaped message used to drive the Agent turn.
      await this.bridge.recordTranscript(displayEvent, row, true)
      const reply = await this.bridge.reply(message, group, member)
      await this.api.sendReplyWithActiveFallback(account, message.chatType === 'group' ? message.groupOpenid! : message.senderId, reply, {
        group: message.chatType === 'group', messageId: message.messageId || null, format: message.chatType === 'group' ? settings.groupReplyFormat : settings.directReplyFormat,
      })
      this.db.insertMessage({
        accountId: message.accountId, chatType: message.chatType, groupId: group?.id,
        memberId: message.chatType === 'c2c' ? member.id : undefined, direction: 'outbound', content: reply, mentioned: false,
      })
      if (group) this.memory.schedule(Number(group.id))
      else this.memory.scheduleMember(Number(member.id))
    } catch (error) {
      this.logger.error?.(`[dsh-qqchat] QQ turn failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    }
  }

  private chatRow(chatType: ChatType, rowId: number): GroupRow | MemberRow | undefined {
    return chatType === 'group' ? this.db.groupById(Number(rowId)) : this.db.memberById(Number(rowId))
  }

  private async flushOutbox(): Promise<void> {
    const settings = this.settings()
    for (const item of this.db.dueOutbox()) {
      try {
        const account = this.db.accountById(Number(item.account_id))
        if (!account) throw new Error('QQ account missing')
        await this.api.sendText(account, item.target_id, item.content, {
        group: item.chat_type === 'group', messageId: null, format: item.chat_type === 'group' ? settings.groupReplyFormat : settings.directReplyFormat,
        })
        this.db.finishOutbox(Number(item.id))
      } catch (error) {
        this.db.finishOutbox(Number(item.id), error instanceof Error ? error.message : String(error))
      }
    }
  }
}

function isGroupReceiveMode(value: unknown): value is GroupReceiveMode { return value === 'auto' || value === 'mention' || value === 'silent' }
function isReplyFormat(value: unknown): value is ReplyFormat { return value === 'smart' || value === 'markdown' || value === 'compat' }
function shortId(value: string): string { return value.length > 10 ? `…${value.slice(-10)}` : value }
