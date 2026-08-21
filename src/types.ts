import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export type ChatType = 'c2c' | 'group'
export type MessageDirection = 'inbound' | 'outbound'
export type MemoryScopeType = 'group' | 'member'
export type MemoryDocType = 'profile' | 'summary' | 'daily' | 'memory' | 'pattern'
export type ProfileEntryType = 'name' | 'address' | 'pronoun' | 'background' | 'preference' | 'note'

export interface ProfileEntry {
  type: ProfileEntryType
  text: string
  ts: number
}

export interface DailyEntry {
  date: string
  note: string
}
export type ReplyFormat = 'smart' | 'markdown' | 'compat'
export type GroupReceiveMode = 'auto' | 'mention' | 'silent'
export type GatewayStatus = 'offline' | 'connecting' | 'online' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type QQMediaKind = 'image' | 'audio' | 'video' | 'voice' | 'file'

export interface QQAttachmentInput {
  sourceUrl?: string
  filename: string
  contentType?: string
  size?: number
  width?: number
  height?: number
  durationMs?: number
  platformFileId?: string
  quoted?: boolean
  kind?: QQMediaKind
  attachmentId?: string
}

export interface QQQuoteInput {
  messageId?: string
  senderId?: string
  senderName?: string
  text: string
  attachments: QQAttachmentInput[]
}

export interface StoredAttachmentSummary {
  id: string
  kind: QQMediaKind
  filename: string
  contentType?: string
  sizeBytes: number
  quoted: boolean
  localPath?: string
  imageRef?: ImageAttachmentRef
}

export interface QQChatRuntimeSettings {
  memoryEnabled: boolean
  groupReceiveMode: GroupReceiveMode
  groupReplyFormat: ReplyFormat
  directReplyFormat: ReplyFormat
  directStreamingEnabled: boolean
  groupMembersCanUseTools: boolean
  groupMembersCanReceiveMedia: boolean
  groupMembersCanReadMedia: boolean
  ownerUserId: string
}

export interface QQChatRuntimeSettingsPatch {
  memoryEnabled?: boolean
  groupReceiveMode?: GroupReceiveMode
  groupReplyFormat?: ReplyFormat
  directReplyFormat?: ReplyFormat
  directStreamingEnabled?: boolean
  groupMembersCanUseTools?: boolean
  groupMembersCanReceiveMedia?: boolean
  groupMembersCanReadMedia?: boolean
  ownerUserId?: string
}

export interface PluginLogEntry {
  id: number
  time: number
  level: LogLevel
  message: string
}

export interface LoggerLike {
  error?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

export interface QQChatConfigInput {
  dataDir?: string
  source?: string
  sandbox?: boolean
  agentPreset?: string
  provider?: string
  model?: string
  maxTokens?: number
  groupChatEnabled?: boolean
  groupRequiresAt?: boolean
  groupReadEnabled?: boolean
  replyFormat?: ReplyFormat
  recentGroupMessages?: number
  reflectionIdleMs?: number
  reflectionBatchSize?: number
  reflectionMaxMessages?: number
  memoryMaxTokens?: number
  memoryCompressionMaxTokens?: number
}

export interface QQChatConfig {
  readonly dataDir: string
  readonly source: string
  readonly sandbox: boolean
  readonly agentPreset?: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
  readonly groupChatEnabled: boolean
  readonly groupRequiresAt: boolean
  readonly groupReadEnabled: boolean
  readonly replyFormat: ReplyFormat
  readonly recentGroupMessages: number
  readonly reflectionIdleMs: number
  readonly reflectionBatchSize: number
  readonly reflectionMaxMessages: number
  readonly memoryMaxTokens: number
  readonly memoryCompressionMaxTokens: number
}

export interface AccountRow {
  id: number
  app_id: string
  app_secret: string
  bot_user_id: string | null
  enabled: 0 | 1
  sandbox: 0 | 1
  gateway_status: GatewayStatus
  gateway_last_error: string | null
  created_at: number
  updated_at: number
}

export interface PublicAccountRow extends Omit<AccountRow, 'app_secret'> {}

export interface AuthTaskRow {
  task_id: string
  aes_key: string
  expires_at: number
}

export interface GroupRow {
  id: number
  account_id: number
  platform_group_id: string
  name: string | null
  enabled: 0 | 1
  read_enabled: 0 | 1
  dsh_session_id: string | null
  created_at: number
  updated_at: number
}

export interface GroupListRow extends GroupRow {
  last_message_at: number | null
  member_count: number
  message_count: number
}

export interface DirectChatListRow extends MemberRow {
  last_message_at: number | null
  message_count: number
}

export interface ChatTargetRow {
  chatType: ChatType
  rowId: number
  accountId: number
  platformId: string
  displayName: string
  dshSessionId: string | null
  lastMessageAt: number | null
  messageCount: number
}

export interface GroupDefaults {
  name?: string
  enabled?: boolean
  readEnabled?: boolean
}

export interface GroupPatch {
  name?: string
  enabled?: boolean
  readEnabled?: boolean
}

export interface MemberRow {
  id: number
  account_id: number
  platform_user_id: string
  display_name: string | null
  dsh_session_id: string | null
  first_seen_at: number
  last_seen_at: number
}

export interface GroupMemberRow {
  id: number
  platform_user_id: string
  global_display_name: string | null
  display_name: string | null
  first_seen_at: number
  last_seen_at: number
  aliases_json: string | null
  nicknames_json: string | null
  message_count: number
}

export interface MessageRow {
  id: number
  account_id: number
  platform_message_id: string | null
  chat_type: ChatType
  group_id: number | null
  member_id: number | null
  direction: MessageDirection
  content: string
  quoted_text: string | null
  mentioned: 0 | 1
  created_at: number
  raw_json: string | null
  attachments_json: string | null
  quote_json: string | null
  platform_user_id?: string | null
  display_name?: string | null
}

export interface InsertMessageInput {
  accountId: number
  platformMessageId?: string
  chatType: ChatType
  groupId?: number
  memberId?: number
  direction: MessageDirection
  content: string
  quotedText?: string
  mentioned?: boolean
  createdAt?: number
  raw?: unknown
  attachments?: StoredAttachmentSummary[]
  quote?: QQQuoteInput
}

export interface ReflectionStateRow {
  group_id: number
  last_message_id: number
  last_reflected_at: number | null
}

export interface OutboxRow {
  id: number
  account_id: number
  chat_type: ChatType
  target_id: string
  content: string
  status: 'pending' | 'sent' | 'failed'
  scheduled_at: number
  sent_at: number | null
  error: string | null
}

export type MemoryDocuments = Partial<Record<MemoryDocType, string>>

export interface QQChatDisplayEvent {
  messageId: string
  chatType: ChatType
  chatId: string
  direction: MessageDirection
  senderId: string
  senderName: string
  isOwner?: boolean
  content: string
  quotedText: string
  mentioned: boolean
  createdAt: number
  sessionId?: string
  attachments?: StoredAttachmentSummary[]
  quote?: QQQuoteInput
}

export interface QQNormalizedMessage {
  platform: 'qq'
  accountId: number
  chatType: ChatType
  chatId: string
  senderId: string
  senderName: string
  groupOpenid?: string
  messageId: string
  msgIdx?: string
  refMsgIdx?: string
  text: string
  quotedText: string
  attachments: QQAttachmentInput[]
  quote?: QQQuoteInput
  mentioned: boolean
  botMentionId: string
  raw: Record<string, unknown>
}

export interface QQQuoteIndexInput {
  accountId: number
  chatType: ChatType
  chatId: string
  msgIdx: string
  platformMessageId?: string
  senderId: string
  senderName?: string
  content: string
  attachments: QQAttachmentInput[]
  createdAt: number
  expiresAt: number
}

export interface QQQuoteIndexRow extends QQQuoteIndexInput {
  id: number
}

export interface QQAuthor {
  user_openid?: string
  member_openid?: string
  id?: string
  username?: string
  nickname?: string
  [key: string]: unknown
}

export interface QQMention {
  bot?: boolean
  is_you?: boolean
  id?: string
  user_openid?: string
  member_openid?: string
  openid?: string
  [key: string]: unknown
}

export interface QQDispatchData extends Record<string, unknown> {
  id?: string
  content?: string
  group_openid?: string
  author?: QQAuthor
  mentions?: QQMention[]
  message_reference?: Record<string, unknown>
  reference?: Record<string, unknown>
  quote?: Record<string, unknown>
  msg_elements?: Array<Record<string, unknown>>
  message_scene?: { ext?: unknown[] }
  attachments?: Array<Record<string, unknown>>
}

export interface QQAccessTokenPayload {
  access_token?: string
  expires_in?: number | string
  [key: string]: unknown
}

export interface QQGatewayPayload {
  url?: string
  [key: string]: unknown
}

export interface QQBindCreatePayload {
  retcode?: number
  msg?: string
  data?: { task_id?: string }
}

export interface QQBindPollPayload {
  retcode?: number
  msg?: string
  data?: {
    status?: number
    bot_appid?: string | number
    bot_encrypt_secret?: string
  }
}

export interface QQGatewayFrame {
  op: number
  s?: number
  t?: string
  d?: Record<string, unknown> & {
    heartbeat_interval?: number
    session_id?: string
    user?: { id?: string; openid?: string }
  }
}

export interface QQSendOptions {
  group?: boolean
  messageId?: string | null
  format?: ReplyFormat
}

export interface ModelRoute {
  provider: string
  model: string
  sessionId?: string
}

export interface PendingReply {
  text: string
  onTextDelta?: (delta: string) => void
}

export interface ReflectionGroupUpdate {
  profile?: unknown
  summary?: unknown
  daily?: unknown
  memory?: unknown
}

export interface ReflectionMemberUpdate {
  senderId?: unknown
  profile?: unknown
  pattern?: unknown
  summary?: unknown
  memory?: unknown
  nicknames?: unknown
}

export interface ReflectionPayload {
  group?: ReflectionGroupUpdate
  members?: ReflectionMemberUpdate[]
}

export interface MemoryViewMember extends GroupMemberRow {
  memory: MemoryDocuments
}

export interface MemoryView {
  group: GroupRow
  groupMemory: MemoryDocuments
  members: MemoryViewMember[]
}
