import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { QQChatRuntime } from '../session/runtime.js'
import type {
  ChatType,
  GroupListRow,
  GroupPatch,
  GroupRow,
  MemoryDocuments,
  MessageRow,
  PublicAccountRow,
  QQChatRuntimeSettingsPatch,
} from '../types.js'

type RpcSuccess<T> = { ok: true; value: T }
type RpcFailure = { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }
export type QQChatRpcResult<T = unknown> = RpcSuccess<T> | RpcFailure
export type QQChatRpcHandler = ConnectionRpcHandler

const ok = <T>(value: T): RpcSuccess<T> => ({ ok: true, value })
const fail = (message: string): RpcFailure => ({ ok: false, error: { code: 'internal', message, details: {} } })

export function createQQChatRpc(runtime: QQChatRuntime): ConnectionRpcHandler {
  return async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'status':
          return ok({
            accounts: runtime.db.publicAccounts().map(publicAccount),
            databasePath: runtime.db.path,
            settings: runtime.settings(),
            config: {
              agentPreset: runtime.config.agentPreset || null,
              provider: runtime.config.provider || null,
              model: runtime.config.model || null,
              reflectionIdleMs: runtime.config.reflectionIdleMs,
              reflectionBatchSize: runtime.config.reflectionBatchSize,
            },
          })
        case 'auth/start':
          return ok(await runtime.auth.start())
        case 'auth/poll': {
          const result = await runtime.auth.poll(requireString(payload, 'taskId'))
          if (result.status === 'success') {
            const account = runtime.db.accountById(Number(result.account.id))
            runtime.startGateway(account)
          }
          return ok(result)
        }
        case 'account/manual-connect': {
          const record = asRecord(payload)
          const account = await runtime.connectManual(
            requireString(payload, 'appId'),
            requireString(payload, 'appSecret'),
            record?.sandbox === true,
          )
          return ok({ account: publicAccount(account) })
        }
        case 'account/reconnect': {
          const id = requireNumber(payload, 'accountId')
          runtime.db.setAccountEnabled(id, true)
          await runtime.restartGateway(id)
          return ok(true)
        }
        case 'account/disconnect': {
          const id = requireNumber(payload, 'accountId')
          runtime.db.setAccountEnabled(id, false)
          await runtime.restartGateway(id)
          return ok(true)
        }
        case 'settings/get':
          return ok({
            settings: runtime.settings(),
            members: runtime.db.listKnownMembers().map(member => ({
              id: Number(member.id),
              platformUserId: member.platform_user_id,
              displayName: member.display_name || '',
              lastSeenAt: Number(member.last_seen_at),
            })),
          })
        case 'settings/update':
          return ok({ settings: runtime.updateSettings(asSettingsPatch(asRecord(payload)?.patch)) })
        case 'logs/list': {
          const limit = Math.max(1, Math.min(500, Number(asRecord(payload)?.limit || 200)))
          return ok({ logs: runtime.logger.list(limit) })
        }
        case 'chats/list':
          return ok({ chats: runtime.listChats().map(chat => ({
            chatType: chat.chatType,
            rowId: chat.rowId,
            accountId: chat.accountId,
            platformId: chat.platformId,
            displayName: chat.displayName,
            dshSessionId: chat.dshSessionId,
            lastMessageAt: chat.lastMessageAt,
            messageCount: chat.messageCount,
          })) })
        case 'chat/ensure': {
          const chatType = requireChatType(payload)
          const rowId = requireNumber(payload, 'rowId')
          return ok({ sessionId: await runtime.ensureChatSession(chatType, rowId) })
        }
        case 'chat/send': {
          const chatType = requireChatType(payload)
          const rowId = requireNumber(payload, 'rowId')
          const content = requireString(payload, 'content')
          return ok({ sessionId: await runtime.sendActive(chatType, rowId, content) })
        }
        case 'attachment/read': {
          const sessionId = requireString(payload, 'sessionId')
          const attachmentId = requireString(payload, 'attachmentId')
          return ok(await runtime.readAttachment(sessionId, attachmentId))
        }
        case 'chat/info': {
          const sessionId = requireString(payload, 'sessionId')
          const group = runtime.db.groupBySession(sessionId)
          if (group) {
            const view = runtime.memory.memoryView(Number(group.id))
            if (!view) throw new Error('群不存在')
            return ok({
              chatType: 'group' as const,
              rowId: Number(group.id),
              title: group.name || `QQ群 ${shortId(group.platform_group_id)}`,
              platformId: group.platform_group_id,
              memory: normalizeMemory(view.groupMemory),
              members: view.members.map(member => ({
                id: Number(member.id),
                platformUserId: member.platform_user_id,
                displayName: member.display_name || '',
                aliases: parseStringList(member.aliases_json),
                nicknames: parseStringList(member.nicknames_json),
                messageCount: Number(member.message_count || 0),
                memory: normalizeMemory(member.memory),
              })),
            })
          }
          const member = runtime.db.memberBySession(sessionId)
          if (!member) throw new Error('不是 QQ Chat session')
          return ok({
            chatType: 'c2c' as const,
            rowId: Number(member.id),
            title: member.display_name || `QQ 用户 ${shortId(member.platform_user_id)}`,
            platformId: member.platform_user_id,
            memory: normalizeMemory(runtime.db.memoryDocs('member', Number(member.id))),
            members: [],
          })
        }
        case 'groups/list':
          return ok({ groups: runtime.db.listGroups().map(publicGroup) })
        case 'group/get': {
          const id = requireNumber(payload, 'groupId')
          const view = runtime.memory.memoryView(id)
          if (!view) throw new Error('群不存在')
          return ok({
            group: publicGroup(view.group),
            groupMemory: normalizeMemory(view.groupMemory),
            members: view.members.map(member => ({
              id: Number(member.id),
              platformUserId: member.platform_user_id,
              displayName: member.display_name || '',
              aliases: parseStringList(member.aliases_json),
              nicknames: parseStringList(member.nicknames_json),
              messageCount: Number(member.message_count || 0),
              firstSeenAt: Number(member.first_seen_at),
              lastSeenAt: Number(member.last_seen_at),
              memory: normalizeMemory(member.memory),
            })),
          })
        }
        case 'group/messages': {
          const id = requireNumber(payload, 'groupId')
          const limit = Math.max(1, Math.min(300, Number(asRecord(payload)?.limit || 120)))
          return ok({ messages: runtime.db.listMessages(id, limit).map(publicMessage) })
        }
        case 'group/update': {
          const id = requireNumber(payload, 'groupId')
          const patch = asGroupPatch(asRecord(payload)?.patch)
          const row = runtime.db.updateGroup(id, patch)
          if (!row) throw new Error('群不存在')
          return ok(publicGroup(row))
        }
        case 'group/send': {
          const id = requireNumber(payload, 'groupId')
          const content = requireString(payload, 'content')
          return ok({ sessionId: await runtime.sendActive('group', id, content) })
        }
        case 'group/reflect': {
          if (!runtime.settings().memoryEnabled) throw new Error('记忆系统已关闭，请先在设置中重新启用')
          const id = requireNumber(payload, 'groupId')
          const view = await runtime.memory.reflectNow(id)
          return ok({ groupMemory: normalizeMemory(view.groupMemory) })
        }
        default:
          throw new Error(`未知 QQ Chat RPC endpoint: ${endpoint}`)
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }
}

function publicAccount(row: PublicAccountRow) {
  return {
    id: Number(row.id), appId: row.app_id, botUserId: row.bot_user_id || null,
    enabled: row.enabled === 1, sandbox: row.sandbox === 1,
    gatewayStatus: row.gateway_status, gatewayLastError: row.gateway_last_error || null,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

function publicGroup(row: GroupRow | GroupListRow) {
  const aggregate = row as Partial<GroupListRow>
  return {
    id: Number(row.id), accountId: Number(row.account_id), platformGroupId: row.platform_group_id,
    name: row.name || '', enabled: row.enabled === 1,
    readEnabled: row.read_enabled === 1, dshSessionId: row.dsh_session_id || null,
    memberCount: Number(aggregate.member_count || 0), messageCount: Number(aggregate.message_count || 0),
    lastMessageAt: aggregate.last_message_at ? Number(aggregate.last_message_at) : null,
  }
}

function publicMessage(row: MessageRow) {
  return {
    id: Number(row.id), platformMessageId: row.platform_message_id || null,
    direction: row.direction, content: row.content, quotedText: row.quoted_text || '',
    mentioned: row.mentioned === 1, createdAt: Number(row.created_at),
    senderId: row.platform_user_id || (row.direction === 'outbound' ? 'BOT' : ''),
    senderName: row.display_name || (row.direction === 'outbound' ? 'DSH Agent' : ''),
    attachments: parseAttachments(row.attachments_json),
    quote: parseQuote(row.quote_json),
  }
}

function parseAttachments(value: string | null): Array<Record<string, unknown>> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map(item => {
      if (!item || typeof item !== 'object') return null
      const { localPath: _localPath, ...publicRecord } = item as Record<string, unknown>
      return publicRecord
    }).filter((item): item is Record<string, unknown> => Boolean(item))
  } catch { return [] }
}

function parseQuote(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    return { ...record, attachments: Array.isArray(record.attachments) ? record.attachments : [] }
  } catch { return null }
}

function normalizeMemory(memory: MemoryDocuments) {
  return {
    profile: memory.profile || '', summary: memory.summary || '', daily: memory.daily || '',
    memory: memory.memory || '', pattern: memory.pattern || '',
  }
}

function parseStringList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function requireString(payload: unknown, key: string): string {
  const value = asRecord(payload)?.[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 必须是非空字符串`)
  return value.trim()
}

function requireNumber(payload: unknown, key: string): number {
  const value = Number(asRecord(payload)?.[key])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} 必须是正整数`)
  return value
}

function requireChatType(payload: unknown): ChatType {
  const value = asRecord(payload)?.chatType
  if (value !== 'group' && value !== 'c2c') throw new Error('chatType 必须是 group 或 c2c')
  return value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function asGroupPatch(value: unknown): GroupPatch {
  const record = asRecord(value)
  if (!record) return {}
  const patch: GroupPatch = {}
  if (typeof record.name === 'string') patch.name = record.name
  if (typeof record.enabled === 'boolean') patch.enabled = record.enabled
  if (typeof record.readEnabled === 'boolean') patch.readEnabled = record.readEnabled
  return patch
}

function asSettingsPatch(value: unknown): QQChatRuntimeSettingsPatch {
  const record = asRecord(value)
  if (!record) return {}
  const patch: QQChatRuntimeSettingsPatch = {}
  if (typeof record.memoryEnabled === 'boolean') patch.memoryEnabled = record.memoryEnabled
  if (typeof record.memoryMemberBatchEnabled === 'boolean') patch.memoryMemberBatchEnabled = record.memoryMemberBatchEnabled
  if (record.groupReceiveMode === 'auto' || record.groupReceiveMode === 'mention' || record.groupReceiveMode === 'silent') {
    patch.groupReceiveMode = record.groupReceiveMode
  }
  if (record.groupReplyFormat === 'smart' || record.groupReplyFormat === 'markdown' || record.groupReplyFormat === 'compat') patch.groupReplyFormat = record.groupReplyFormat
  if (record.directReplyFormat === 'smart' || record.directReplyFormat === 'markdown' || record.directReplyFormat === 'compat') patch.directReplyFormat = record.directReplyFormat
  if (typeof record.directStreamingEnabled === 'boolean') patch.directStreamingEnabled = record.directStreamingEnabled
  if (typeof record.groupMembersCanUseTools === 'boolean') patch.groupMembersCanUseTools = record.groupMembersCanUseTools
  if (typeof record.groupMembersCanReceiveMedia === 'boolean') patch.groupMembersCanReceiveMedia = record.groupMembersCanReceiveMedia
  if (typeof record.groupMembersCanReadMedia === 'boolean') patch.groupMembersCanReadMedia = record.groupMembersCanReadMedia
  if (typeof record.ownerUserId === 'string') patch.ownerUserId = record.ownerUserId
  return patch
}

function shortId(value: string): string {
  return value.length > 10 ? `…${value.slice(-10)}` : value
}
