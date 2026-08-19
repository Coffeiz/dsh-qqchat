import type { Context } from '@deepseek-ai/cordis'
import type { DshQQBridge } from './agent-bridge.js'
import type { QQChatDatabase } from './db.js'
import type { MemoryEngine } from './memory.js'
import type { QQApiClient } from './qq-api.js'
import type { QQBindService } from './qq-auth.js'
import { QQGateway } from './qq-gateway.js'
import type { AccountRow, LoggerLike, QQChatConfig, QQNormalizedMessage } from './types.js'

export class QQChatRuntime {
  readonly gateways = new Map<number, QQGateway>()
  private outboxTimer?: ReturnType<typeof setInterval>

  constructor(
    readonly ctx: Context,
    readonly db: QQChatDatabase,
    readonly api: QQApiClient,
    readonly auth: QQBindService,
    readonly memory: MemoryEngine,
    readonly bridge: DshQQBridge,
    readonly config: QQChatConfig,
    readonly logger: LoggerLike = console,
  ) {}

  async start(): Promise<void> {
    for (const account of this.db.enabledAccounts()) this.startGateway(account)
    this.outboxTimer = setInterval(() => void this.flushOutbox(), 3000)
    this.outboxTimer.unref?.()
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
    let group = undefined
    let shouldReply = true
    let shouldRecord = true
    if (message.chatType === 'group') {
      if (!this.config.groupChatEnabled || !message.groupOpenid) return
      group = this.db.upsertGroup(message.accountId, message.groupOpenid, {
        enabled: true,
        requiresAt: this.config.groupRequiresAt,
        readEnabled: this.config.groupReadEnabled,
      })
      this.db.touchGroupMember(Number(group.id), Number(member.id), message.senderName)
      shouldReply = group.enabled === 1 && (message.mentioned || group.requires_at === 0)
      shouldRecord = shouldReply || group.read_enabled === 1
      if (!shouldRecord) return
    }

    this.db.insertMessage({
      accountId: message.accountId,
      platformMessageId: message.messageId,
      chatType: message.chatType,
      groupId: group?.id,
      memberId: member.id,
      direction: 'inbound',
      content: message.text,
      quotedText: message.quotedText,
      mentioned: message.mentioned,
      raw: message.raw,
    })
    if (group) this.memory.schedule(Number(group.id))
    if (!shouldReply) return

    try {
      const reply = await this.bridge.reply(message, group, member)
      await this.api.sendReplyWithActiveFallback(
        account,
        message.chatType === 'group' ? message.groupOpenid! : message.senderId,
        reply,
        {
          group: message.chatType === 'group',
          messageId: message.messageId || null,
          format: this.config.replyFormat,
        },
      )
      this.db.insertMessage({
        accountId: message.accountId,
        chatType: message.chatType,
        groupId: group?.id,
        direction: 'outbound',
        content: reply,
        mentioned: false,
      })
      if (group) this.memory.schedule(Number(group.id))
    } catch (error) {
      this.logger.error?.(`[dsh-qqchat] QQ turn failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    }
  }

  async sendActiveGroup(groupId: number, content: string): Promise<void> {
    const group = this.db.groupById(Number(groupId))
    if (!group) throw new Error('群不存在')
    const account = this.db.accountById(Number(group.account_id))
    if (!account) throw new Error('QQ 账号不存在')
    await this.api.sendText(account, group.platform_group_id, content, {
      group: true,
      messageId: null,
      format: this.config.replyFormat,
    })
    this.db.insertMessage({
      accountId: Number(account.id),
      chatType: 'group',
      groupId: Number(group.id),
      direction: 'outbound',
      content,
    })
    this.memory.schedule(Number(group.id))
  }

  private async flushOutbox(): Promise<void> {
    for (const item of this.db.dueOutbox()) {
      try {
        const account = this.db.accountById(Number(item.account_id))
        if (!account) throw new Error('QQ account missing')
        await this.api.sendText(account, item.target_id, item.content, {
          group: item.chat_type === 'group',
          messageId: null,
          format: this.config.replyFormat,
        })
        this.db.finishOutbox(Number(item.id))
      } catch (error) {
        this.db.finishOutbox(Number(item.id), error instanceof Error ? error.message : String(error))
      }
    }
  }
}
