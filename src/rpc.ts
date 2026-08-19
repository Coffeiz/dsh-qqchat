import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { QQChatRuntime } from './runtime.js'
import type {
  GroupListRow,
  GroupPatch,
  GroupRow,
  MemoryDocuments,
  MessageRow,
  PublicAccountRow,
} from './types.js'

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
            config: {
              agentPreset: runtime.config.agentPreset || null,
              provider: runtime.config.provider || null,
              model: runtime.config.model || null,
              groupRequiresAt: runtime.config.groupRequiresAt,
              groupReadEnabled: runtime.config.groupReadEnabled,
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
          const content = requireString(payload, 'content').trim()
          if (!content) throw new Error('消息不能为空')
          await runtime.sendActiveGroup(id, content)
          return ok(true)
        }
        case 'group/reflect': {
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
    name: row.name || '', enabled: row.enabled === 1, requiresAt: row.requires_at === 1,
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
  }
}

function normalizeMemory(memory: MemoryDocuments) {
  return {
    profile: memory.profile || '', summary: memory.summary || '', daily: memory.daily || '',
    memory: memory.memory || '', pattern: memory.pattern || '',
  }
}

function requireString(payload: unknown, key: string): string {
  const value = asRecord(payload)?.[key]
  if (typeof value !== 'string' || !value) throw new Error(`${key} 必须是非空字符串`)
  return value
}

function requireNumber(payload: unknown, key: string): number {
  const value = Number(asRecord(payload)?.[key])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} 必须是正整数`)
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
  if (typeof record.requiresAt === 'boolean') patch.requiresAt = record.requiresAt
  if (typeof record.readEnabled === 'boolean') patch.readEnabled = record.readEnabled
  return patch
}
