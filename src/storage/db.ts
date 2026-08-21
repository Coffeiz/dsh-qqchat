import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AccountRow,
  AuthTaskRow,
  ChatType,
  DirectChatListRow,
  DailyEntry,
  GroupDefaults,
  GroupListRow,
  GroupMemberRow,
  GroupPatch,
  GroupRow,
  InsertMessageInput,
  MemberRow,
  MemoryDocuments,
  MemoryDocType,
  MemoryScopeType,
  MessageRow,
  OutboxRow,
  PublicAccountRow,
  QQChatRuntimeSettings,
  QQAttachmentInput,
  QQMediaKind,
  QQQuoteIndexInput,
  QQQuoteIndexRow,
  QQQuoteInput,
  StoredAttachmentSummary,
} from '../types.js'

const now = (): number => Date.now()

function parseStringList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : []
  } catch {
    return []
  }
}

function profileTypeForKey(key: string): string {
  if (key === 'name' || key === 'name_observed' || key === 'display_name' || key === 'nickname') return 'name'
  if (key === 'address') return 'address'
  if (key === 'pronoun') return 'pronoun'
  if (key === 'background' || key === 'dev_env') return 'background'
  if (key === 'preference') return 'preference'
  return 'note'
}

function parseDailyEntries(value: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  let date = ''
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line)
    if (heading) {
      date = heading[1] || ''
      continue
    }
    if (!date || !line) continue
    const note = line.startsWith('- ') ? line.slice(2).trim() : line
    if (note) entries.push([date, note])
  }
  return entries
}

function renderDailyEntries(entries: Array<[string, string]>): string {
  const out: string[] = []
  let current = ''
  for (const [date, note] of entries) {
    if (!date || !note) continue
    if (date !== current) {
      if (out.length) out.push('')
      out.push(`## ${date}`)
      current = date
    }
    out.push(`- ${note}`)
  }
  return out.join('\n')
}

function one<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : value as T
}

function many<T>(value: unknown): T[] {
  return value as T[]
}

export class QQChatDatabase {
  readonly path: string
  private readonly db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.path = path
    this.db = new DatabaseSync(path)
    try { chmodSync(path, 0o600) } catch {}
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.migrate()
  }

  close(): void { this.db.close() }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        app_id TEXT NOT NULL UNIQUE,
        app_secret TEXT NOT NULL,
        bot_user_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        sandbox INTEGER NOT NULL DEFAULT 0,
        gateway_status TEXT NOT NULL DEFAULT 'offline',
        gateway_last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_tasks (
        task_id TEXT PRIMARY KEY,
        aes_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        platform_group_id TEXT NOT NULL,
        name TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        read_enabled INTEGER NOT NULL DEFAULT 1,
        dsh_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, platform_group_id)
      );
      CREATE TABLE IF NOT EXISTS qq_quote_index (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        chat_type TEXT NOT NULL CHECK(chat_type IN ('c2c','group')),
        chat_id TEXT NOT NULL,
        msg_idx TEXT NOT NULL,
        platform_message_id TEXT,
        sender_id TEXT NOT NULL,
        sender_name TEXT,
        content TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE(account_id, chat_type, chat_id, msg_idx)
      );
      CREATE INDEX IF NOT EXISTS qq_quote_index_expiry ON qq_quote_index(expires_at);
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        platform_user_id TEXT NOT NULL,
        display_name TEXT,
        dsh_session_id TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(account_id, platform_user_id)
      );
      CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        display_name TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        nicknames_json TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(group_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        platform_message_id TEXT,
        chat_type TEXT NOT NULL CHECK(chat_type IN ('c2c','group')),
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
        content TEXT NOT NULL,
        quoted_text TEXT,
        mentioned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        raw_json TEXT,
        attachments_json TEXT,
        quote_json TEXT
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        source_message_id TEXT,
        source_file_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('image','audio','video','voice','file')),
        filename TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        local_path TEXT,
        image_ref_json TEXT,
        status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','attached','expired','deleted','failed')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS attachments_source ON attachments(account_id, source_message_id, source_file_id);
      CREATE TABLE IF NOT EXISTS message_attachments (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('own','quoted')),
        ordinal INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(message_id, attachment_id, role)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS messages_platform_unique
        ON messages(account_id, platform_message_id, direction)
        WHERE platform_message_id IS NOT NULL AND platform_message_id <> '';
      CREATE INDEX IF NOT EXISTS messages_group_created ON messages(group_id, created_at, id);
      CREATE INDEX IF NOT EXISTS messages_member_created ON messages(member_id, chat_type, created_at, id);
      CREATE TABLE IF NOT EXISTS plugin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_documents (
        scope_type TEXT NOT NULL CHECK(scope_type IN ('group','member')),
        scope_key INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(scope_type, scope_key, doc_type)
      );
      CREATE TABLE IF NOT EXISTS reflection_state (
        group_id INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
        last_message_id INTEGER NOT NULL DEFAULT 0,
        last_reflected_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        chat_type TEXT NOT NULL CHECK(chat_type IN ('c2c','group')),
        target_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        scheduled_at INTEGER NOT NULL,
        sent_at INTEGER,
        error TEXT
      );
    `)
    const columns = new Set(many<{ name: string }>(this.db.prepare('PRAGMA table_info(group_members)').all()).map(column => column.name))
    const groupColumns = new Set(many<{ name: string }>(this.db.prepare('PRAGMA table_info(groups)').all()).map(column => column.name))
    if (groupColumns.has('requires_at')) this.db.exec('ALTER TABLE groups DROP COLUMN requires_at')
    if (!columns.has('aliases_json')) this.db.exec("ALTER TABLE group_members ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'")
    if (!columns.has('nicknames_json')) this.db.exec("ALTER TABLE group_members ADD COLUMN nicknames_json TEXT NOT NULL DEFAULT '[]'")
    if (!columns.has('message_count')) this.db.exec('ALTER TABLE group_members ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0')
    const messageColumns = new Set(many<{ name: string }>(this.db.prepare('PRAGMA table_info(messages)').all()).map(column => column.name))
    if (!messageColumns.has('attachments_json')) this.db.exec('ALTER TABLE messages ADD COLUMN attachments_json TEXT')
    if (!messageColumns.has('quote_json')) this.db.exec('ALTER TABLE messages ADD COLUMN quote_json TEXT')
    this.db.exec(`UPDATE group_members SET message_count=(
      SELECT COUNT(*) FROM messages WHERE messages.group_id=group_members.group_id AND messages.member_id=group_members.member_id
    ) WHERE message_count=0`)
    this.migrateMemberProfiles()
    this.normalizeDailyDocuments()
  }

  private migrateMemberProfiles(): void {
    const rows = many<{ scope_key: number; content: string }>(this.db.prepare(
      "SELECT scope_key,content FROM memory_documents WHERE scope_type='member' AND doc_type='profile'",
    ).all())
    const update = this.db.prepare(
      "UPDATE memory_documents SET content=?,updated_at=? WHERE scope_type='member' AND scope_key=? AND doc_type='profile'",
    )
    for (const row of rows) {
      try {
        const value = JSON.parse(row.content)
        if (Array.isArray(value) || !value || typeof value !== 'object') continue
        const entries = Object.entries(value).map(([key, raw]) => ({
          type: profileTypeForKey(key),
          text: typeof raw === 'string' ? raw : JSON.stringify(raw),
          ts: now(),
        }))
        update.run(JSON.stringify(entries, null, 2), now(), row.scope_key)
      } catch {
        // Preserve malformed legacy content for manual inspection.
      }
    }
  }

  private normalizeDailyDocuments(): void {
    const rows = many<{ scope_type: MemoryScopeType; scope_key: number; content: string }>(this.db.prepare(
      "SELECT scope_type,scope_key,content FROM memory_documents WHERE doc_type='daily'",
    ).all())
    const update = this.db.prepare(
      'UPDATE memory_documents SET content=?,updated_at=? WHERE scope_type=? AND scope_key=? AND doc_type=\'daily\'',
    )
    for (const row of rows) {
      const entries = parseDailyEntries(row.content)
      const normalized = renderDailyEntries(entries)
      if (normalized !== row.content.trim()) update.run(normalized, now(), row.scope_type, row.scope_key)
    }
  }

  pruneAuthTasks(): void { this.db.prepare('DELETE FROM auth_tasks WHERE expires_at <= ?').run(now()) }

  saveAuthTask(taskId: string, aesKey: string, ttlMs = 600_000): void {
    this.pruneAuthTasks()
    this.db.prepare('INSERT OR REPLACE INTO auth_tasks(task_id,aes_key,expires_at) VALUES(?,?,?)')
      .run(taskId, aesKey, now() + ttlMs)
  }

  getAuthTask(taskId: string): AuthTaskRow | undefined {
    this.pruneAuthTasks()
    return one<AuthTaskRow>(this.db.prepare('SELECT * FROM auth_tasks WHERE task_id=?').get(taskId))
  }

  deleteAuthTask(taskId: string): void { this.db.prepare('DELETE FROM auth_tasks WHERE task_id=?').run(taskId) }

  upsertAccount(appId: string, secret: string, sandbox = false): AccountRow {
    const t = now()
    this.db.prepare(`INSERT INTO accounts(app_id,app_secret,enabled,sandbox,created_at,updated_at)
      VALUES(?,?,1,?,?,?)
      ON CONFLICT(app_id) DO UPDATE SET app_secret=excluded.app_secret, enabled=1,
      sandbox=excluded.sandbox, updated_at=excluded.updated_at`)
      .run(appId, secret, sandbox ? 1 : 0, t, t)
    const account = this.accountByAppId(appId)
    if (!account) throw new Error('QQ account upsert did not return a row')
    return account
  }

  accountByAppId(appId: string): AccountRow | undefined {
    return one<AccountRow>(this.db.prepare('SELECT * FROM accounts WHERE app_id=?').get(appId))
  }

  accountById(id: number): AccountRow | undefined {
    return one<AccountRow>(this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id))
  }

  firstEnabledAccount(): AccountRow | undefined {
    return one<AccountRow>(this.db.prepare('SELECT * FROM accounts WHERE enabled=1 ORDER BY id LIMIT 1').get())
  }

  enabledAccounts(): AccountRow[] {
    return many<AccountRow>(this.db.prepare('SELECT * FROM accounts WHERE enabled=1 ORDER BY id').all())
  }

  publicAccounts(): PublicAccountRow[] {
    return many<PublicAccountRow>(this.db.prepare(`SELECT id,app_id,bot_user_id,enabled,sandbox,gateway_status,gateway_last_error,created_at,updated_at
      FROM accounts ORDER BY id`).all())
  }

  setAccountGateway(id: number, status: AccountRow['gateway_status'], error: string | null = null, botUserId?: string): void {
    const sql = botUserId === undefined
      ? 'UPDATE accounts SET gateway_status=?,gateway_last_error=?,updated_at=? WHERE id=?'
      : 'UPDATE accounts SET gateway_status=?,gateway_last_error=?,bot_user_id=?,updated_at=? WHERE id=?'
    const args = botUserId === undefined ? [status, error, now(), id] : [status, error, botUserId, now(), id]
    this.db.prepare(sql).run(...args)
  }

  setAccountEnabled(id: number, enabled: boolean): void {
    this.db.prepare('UPDATE accounts SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, now(), id)
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = one<{ value: string }>(this.db.prepare('SELECT value FROM plugin_settings WHERE key=?').get(key))
    if (!row) return fallback
    try { return JSON.parse(row.value) as T } catch { return fallback }
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare(`INSERT INTO plugin_settings(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(key, JSON.stringify(value), now())
  }

  runtimeSettings(defaults: QQChatRuntimeSettings): QQChatRuntimeSettings {
    return {
      memoryEnabled: this.getSetting('memoryEnabled', defaults.memoryEnabled),
      groupReceiveMode: this.getSetting('groupReceiveMode', defaults.groupReceiveMode),
      groupReplyFormat: this.getSetting('groupReplyFormat', defaults.groupReplyFormat),
      directReplyFormat: this.getSetting('directReplyFormat', this.getSetting('replyFormat', defaults.directReplyFormat)),
      directStreamingEnabled: this.getSetting('directStreamingEnabled', defaults.directStreamingEnabled),
      groupMembersCanUseTools: this.getSetting('groupMembersCanUseTools', defaults.groupMembersCanUseTools),
      groupMembersCanReceiveMedia: this.getSetting('groupMembersCanReceiveMedia', defaults.groupMembersCanReceiveMedia),
      groupMembersCanReadMedia: this.getSetting('groupMembersCanReadMedia', defaults.groupMembersCanReadMedia),
      ownerUserId: this.getSetting('ownerUserId', defaults.ownerUserId),
    }
  }

  upsertGroup(accountId: number, platformGroupId: string, defaults: GroupDefaults = {}): GroupRow {
    const t = now()
    this.db.prepare(`INSERT INTO groups(account_id,platform_group_id,name,enabled,read_enabled,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(account_id,platform_group_id) DO UPDATE SET updated_at=excluded.updated_at`)
    .run(accountId, platformGroupId, defaults.name || null, defaults.enabled === false ? 0 : 1,
        defaults.readEnabled === false ? 0 : 1, t, t)
    const group = this.groupByPlatform(accountId, platformGroupId)
    if (!group) throw new Error('QQ group upsert did not return a row')
    return group
  }

  groupByPlatform(accountId: number, platformGroupId: string): GroupRow | undefined {
    return one<GroupRow>(this.db.prepare('SELECT * FROM groups WHERE account_id=? AND platform_group_id=?').get(accountId, platformGroupId))
  }

  groupById(id: number): GroupRow | undefined {
    return one<GroupRow>(this.db.prepare('SELECT * FROM groups WHERE id=?').get(id))
  }

  updateGroup(id: number, patch: GroupPatch): GroupRow | undefined {
    const row = this.groupById(id)
    if (!row) return undefined
    const next = {
      name: patch.name === undefined ? row.name : String(patch.name || ''),
      enabled: patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
      read_enabled: patch.readEnabled === undefined ? row.read_enabled : patch.readEnabled ? 1 : 0,
    }
    this.db.prepare('UPDATE groups SET name=?,enabled=?,read_enabled=?,updated_at=? WHERE id=?')
      .run(next.name, next.enabled, next.read_enabled, now(), id)
    return this.groupById(id)
  }

  saveQuoteIndex(input: QQQuoteIndexInput): void {
    this.db.prepare(`INSERT INTO qq_quote_index
      (account_id,chat_type,chat_id,msg_idx,platform_message_id,sender_id,sender_name,content,attachments_json,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id,chat_type,chat_id,msg_idx) DO UPDATE SET
        platform_message_id=excluded.platform_message_id,sender_id=excluded.sender_id,sender_name=excluded.sender_name,
        content=excluded.content,attachments_json=excluded.attachments_json,created_at=excluded.created_at,expires_at=excluded.expires_at`)
      .run(input.accountId, input.chatType, input.chatId, input.msgIdx, input.platformMessageId || null,
        input.senderId, input.senderName || null, input.content.slice(0, 200), JSON.stringify(input.attachments), input.createdAt, input.expiresAt)
  }

  quoteIndex(accountId: number, chatType: ChatType, chatId: string, msgIdx: string): QQQuoteIndexRow | undefined {
    const row = one<Record<string, unknown>>(this.db.prepare(`SELECT * FROM qq_quote_index
      WHERE account_id=? AND chat_type=? AND chat_id=? AND msg_idx=? AND expires_at>?`).get(accountId, chatType, chatId, msgIdx, now()))
    if (!row) return undefined
    let attachments: QQAttachmentInput[] = []
    try {
      const parsed = JSON.parse(String(row.attachments_json || '[]'))
      if (Array.isArray(parsed)) attachments = parsed as QQAttachmentInput[]
    } catch {}
    return {
      id: Number(row.id), accountId: Number(row.account_id), chatType: row.chat_type as ChatType, chatId: String(row.chat_id),
      msgIdx: String(row.msg_idx), platformMessageId: row.platform_message_id ? String(row.platform_message_id) : undefined,
      senderId: String(row.sender_id), senderName: row.sender_name ? String(row.sender_name) : undefined,
      content: String(row.content || ''), attachments, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    }
  }

  expireQuoteIndex(before: number): number {
    const result = this.db.prepare('DELETE FROM qq_quote_index WHERE expires_at<=?').run(before)
    return Number(result.changes || 0)
  }

  listGroups(): GroupListRow[] {
    return many<GroupListRow>(this.db.prepare(`SELECT g.*,
      (SELECT MAX(created_at) FROM messages m WHERE m.group_id=g.id) AS last_message_at,
      (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id) AS member_count,
      (SELECT COUNT(*) FROM messages m WHERE m.group_id=g.id) AS message_count
      FROM groups g ORDER BY COALESCE(last_message_at,g.updated_at) DESC`).all())
  }

  listDirectChats(): DirectChatListRow[] {
    return many<DirectChatListRow>(this.db.prepare(`SELECT mem.*,
      (SELECT MAX(created_at) FROM messages m WHERE m.member_id=mem.id AND m.chat_type='c2c') AS last_message_at,
      (SELECT COUNT(*) FROM messages m WHERE m.member_id=mem.id AND m.chat_type='c2c') AS message_count
      FROM members mem
      WHERE EXISTS(SELECT 1 FROM messages m WHERE m.member_id=mem.id AND m.chat_type='c2c')
      ORDER BY COALESCE(last_message_at,mem.last_seen_at) DESC`).all())
  }

  listKnownMembers(): MemberRow[] {
    return many<MemberRow>(this.db.prepare('SELECT * FROM members ORDER BY last_seen_at DESC').all())
  }

  upsertMember(accountId: number, platformUserId: string, displayName = ''): MemberRow {
    const t = now()
    this.db.prepare(`INSERT INTO members(account_id,platform_user_id,display_name,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?) ON CONFLICT(account_id,platform_user_id) DO UPDATE SET
      display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE members.display_name END,
      last_seen_at=excluded.last_seen_at`)
      .run(accountId, platformUserId, displayName, t, t)
    const member = this.memberByPlatform(accountId, platformUserId)
    if (!member) throw new Error('QQ member upsert did not return a row')
    return member
  }

  memberByPlatform(accountId: number, platformUserId: string): MemberRow | undefined {
    return one<MemberRow>(this.db.prepare('SELECT * FROM members WHERE account_id=? AND platform_user_id=?').get(accountId, platformUserId))
  }

  memberById(id: number): MemberRow | undefined {
    return one<MemberRow>(this.db.prepare('SELECT * FROM members WHERE id=?').get(id))
  }

  touchGroupMember(groupId: number, memberId: number, displayName = ''): void {
    const t = now()
    const existing = one<{ display_name: string | null; aliases_json: string | null }>(this.db.prepare(
      'SELECT display_name,aliases_json FROM group_members WHERE group_id=? AND member_id=?',
    ).get(groupId, memberId))
    const aliases = parseStringList(existing?.aliases_json)
    if (displayName && existing?.display_name && displayName !== existing.display_name && !aliases.includes(existing.display_name)) {
      aliases.push(existing.display_name)
    }
    this.db.prepare(`INSERT INTO group_members(group_id,member_id,display_name,first_seen_at,last_seen_at,aliases_json)
      VALUES(?,?,?,?,?,?) ON CONFLICT(group_id,member_id) DO UPDATE SET
      display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE group_members.display_name END,
      last_seen_at=excluded.last_seen_at, aliases_json=excluded.aliases_json`).run(
        groupId, memberId, displayName, t, t, JSON.stringify(aliases),
      )
  }

  listGroupMembers(groupId: number): GroupMemberRow[] {
    return many<GroupMemberRow>(this.db.prepare(`SELECT m.id,m.platform_user_id,m.display_name AS global_display_name,
      COALESCE(NULLIF(gm.display_name,''),m.display_name) AS display_name, gm.first_seen_at,gm.last_seen_at,
      gm.aliases_json,gm.nicknames_json,gm.message_count
      FROM group_members gm JOIN members m ON m.id=gm.member_id WHERE gm.group_id=? ORDER BY gm.last_seen_at DESC`).all(groupId))
  }

  addGroupMemberNickname(groupId: number, memberId: number, nickname: string): void {
    const value = nickname.trim()
    if (!value) return
    const row = one<{ nicknames_json: string | null }>(this.db.prepare(
      'SELECT nicknames_json FROM group_members WHERE group_id=? AND member_id=?',
    ).get(groupId, memberId))
    if (!row) return
    const nicknames = parseStringList(row.nicknames_json)
    if (nicknames.includes(value)) return
    nicknames.push(value)
    this.db.prepare('UPDATE group_members SET nicknames_json=? WHERE group_id=? AND member_id=?')
      .run(JSON.stringify(nicknames), groupId, memberId)
  }

  insertMessage(input: InsertMessageInput): number {
    if (input.platformMessageId) {
      const existing = one<{ id: number }>(this.db.prepare(`SELECT id FROM messages WHERE account_id=? AND platform_message_id=? AND direction=?`)
        .get(input.accountId, input.platformMessageId, input.direction))
      if (existing) {
        this.linkMessageAttachments(Number(existing.id), input.attachments || [])
        return Number(existing.id)
      }
    }
    const result = this.db.prepare(`INSERT INTO messages(account_id,platform_message_id,chat_type,group_id,member_id,direction,
      content,quoted_text,mentioned,created_at,raw_json,attachments_json,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.accountId, input.platformMessageId || null, input.chatType, input.groupId || null,
        input.memberId || null, input.direction, input.content || '', input.quotedText || null,
        input.mentioned ? 1 : 0, input.createdAt || now(), input.raw ? JSON.stringify(input.raw) : null,
        input.attachments?.length ? JSON.stringify(input.attachments) : null, input.quote ? JSON.stringify(input.quote) : null)
    const messageId = Number(result.lastInsertRowid)
    this.linkMessageAttachments(messageId, input.attachments || [])
    if (input.chatType === 'group' && input.groupId && input.memberId) {
      this.db.prepare('UPDATE group_members SET message_count=message_count+1 WHERE group_id=? AND member_id=?')
        .run(input.groupId, input.memberId)
    }
    return messageId
  }

  private linkMessageAttachments(messageId: number, attachments: StoredAttachmentSummary[]): void {
    for (const [ordinal, attachment] of attachments.entries()) {
      this.db.prepare(`INSERT OR IGNORE INTO message_attachments(message_id,attachment_id,role,ordinal) VALUES(?,?,?,?)`)
        .run(messageId, attachment.id, attachment.quoted ? 'quoted' : 'own', ordinal)
      this.db.prepare("UPDATE attachments SET status='attached' WHERE id=?").run(attachment.id)
    }
  }

  saveAttachment(input: {
    id: string
    accountId: number
    sourceMessageId?: string
    sourceFileId?: string
    kind: QQMediaKind
    filename: string
    contentType?: string
    sizeBytes: number
    localPath?: string
    imageRef?: StoredAttachmentSummary['imageRef']
    expiresAt?: number
  }): void {
    this.db.prepare(`INSERT OR REPLACE INTO attachments
      (id,account_id,source_message_id,source_file_id,kind,filename,content_type,size_bytes,local_path,image_ref_json,status,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)`).run(
      input.id, input.accountId, input.sourceMessageId || null, input.sourceFileId || null, input.kind,
      input.filename, input.contentType || null, input.sizeBytes, input.localPath || null,
      input.imageRef ? JSON.stringify(input.imageRef) : null, 'staged', now(), input.expiresAt || null,
    )
  }

  attachmentById(id: string): StoredAttachmentSummary | undefined {
    const row = one<{ id: string; source_file_id: string | null; kind: QQMediaKind; filename: string; content_type: string | null; size_bytes: number; local_path: string | null; image_ref_json: string | null }>(
      this.db.prepare('SELECT id,source_file_id,kind,filename,content_type,size_bytes,local_path,image_ref_json FROM attachments WHERE id=?').get(id),
    )
    if (!row) return undefined
    let imageRef: StoredAttachmentSummary['imageRef'] | undefined
    try { imageRef = row.image_ref_json ? JSON.parse(row.image_ref_json) : undefined } catch {}
    return { id: row.id, sourceFileId: row.source_file_id || undefined, kind: row.kind, filename: row.filename, contentType: row.content_type || undefined,
      sizeBytes: Number(row.size_bytes || 0), quoted: false, localPath: row.local_path || undefined, imageRef }
  }

  findReusableAttachment(accountId: number, sourceMessageId: string, sourceFileId?: string, kind?: QQMediaKind): StoredAttachmentSummary | undefined {
    const row = one<{ id: string; source_file_id: string | null; kind: QQMediaKind; filename: string; content_type: string | null; size_bytes: number; local_path: string | null; image_ref_json: string | null }>(
      this.db.prepare(`SELECT id,source_file_id,kind,filename,content_type,size_bytes,local_path,image_ref_json FROM attachments
        WHERE account_id=? AND source_message_id=? AND status IN ('staged','attached')
          AND (? IS NULL OR source_file_id=? ) AND (? IS NULL OR kind=? ) AND local_path IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`).get(accountId, sourceMessageId, sourceFileId || null, sourceFileId || null, kind || null, kind || null),
    )
    if (!row) return undefined
    let imageRef: StoredAttachmentSummary['imageRef'] | undefined
    try { imageRef = row.image_ref_json ? JSON.parse(row.image_ref_json) : undefined } catch {}
    return { id: row.id, sourceFileId: row.source_file_id || undefined, kind: row.kind, filename: row.filename, contentType: row.content_type || undefined,
      sizeBytes: Number(row.size_bytes || 0), quoted: false, localPath: row.local_path || undefined, imageRef }
  }

  extendAttachment(id: string, expiresAt: number): void {
    this.db.prepare("UPDATE attachments SET expires_at=CASE WHEN expires_at IS NULL OR expires_at<? THEN ? ELSE expires_at END, status='attached' WHERE id=?")
      .run(expiresAt, expiresAt, id)
  }

  attachmentForSession(sessionId: string, attachmentId: string): StoredAttachmentSummary | undefined {
    const row = one<{ id: string; source_file_id: string | null; kind: QQMediaKind; filename: string; content_type: string | null; size_bytes: number; local_path: string | null; image_ref_json: string | null; status: string; expires_at: number | null }>(this.db.prepare(`
      SELECT a.id,a.source_file_id,a.kind,a.filename,a.content_type,a.size_bytes,a.local_path,a.image_ref_json,a.status,a.expires_at
      FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id
      JOIN messages msg ON msg.id=ma.message_id
      LEFT JOIN groups g ON g.id=msg.group_id
      LEFT JOIN members mem ON mem.id=msg.member_id
      WHERE a.id=? AND a.status IN ('staged','attached') AND (a.expires_at IS NULL OR a.expires_at>?)
        AND (
          (msg.chat_type='group' AND g.dsh_session_id=?)
          OR
          (msg.chat_type='c2c' AND mem.dsh_session_id=?)
        )
      LIMIT 1
    `).get(attachmentId, Date.now(), sessionId, sessionId))
    if (!row) return undefined
    let imageRef: StoredAttachmentSummary['imageRef'] | undefined
    try { imageRef = row.image_ref_json ? JSON.parse(row.image_ref_json) : undefined } catch {}
    return { id: row.id, sourceFileId: row.source_file_id || undefined, kind: row.kind, filename: row.filename, contentType: row.content_type || undefined,
      sizeBytes: Number(row.size_bytes || 0), quoted: false, localPath: row.local_path || undefined, imageRef }
  }

  expireAttachments(before: number): number {
    const result = this.db.prepare("UPDATE attachments SET status='expired' WHERE expires_at IS NOT NULL AND expires_at<? AND status IN ('staged','attached')").run(before)
    return Number(result.changes || 0)
  }

  expiredAttachmentPaths(before: number): string[] {
    return many<{ local_path: string | null }>(this.db.prepare(
      "SELECT local_path FROM attachments WHERE expires_at IS NOT NULL AND expires_at<? AND status='expired'",
    ).all(before)).map(row => row.local_path).filter((value): value is string => Boolean(value))
  }

  markAttachmentDeleted(path: string): void {
    this.db.prepare("UPDATE attachments SET status='deleted',local_path=NULL WHERE local_path=?").run(path)
  }

  listMessages(groupId: number, limit = 100): MessageRow[] {
    const rows = many<MessageRow>(this.db.prepare(`SELECT m.*,mem.platform_user_id,mem.display_name
      FROM messages m LEFT JOIN members mem ON mem.id=m.member_id
      WHERE m.group_id=? ORDER BY m.id DESC LIMIT ?`).all(groupId, limit))
    return rows.reverse()
  }

  listDirectMessages(memberId: number, limit = 100): MessageRow[] {
    const rows = many<MessageRow>(this.db.prepare(`SELECT m.*,mem.platform_user_id,mem.display_name
      FROM messages m LEFT JOIN members mem ON mem.id=m.member_id
      WHERE m.chat_type='c2c' AND m.member_id=? ORDER BY m.id DESC LIMIT ?`).all(memberId, limit))
    return rows.reverse()
  }

  groupBySession(sessionId: string): GroupRow | undefined {
    return one<GroupRow>(this.db.prepare('SELECT * FROM groups WHERE dsh_session_id=?').get(sessionId))
  }

  memberBySession(sessionId: string): MemberRow | undefined {
    return one<MemberRow>(this.db.prepare('SELECT * FROM members WHERE dsh_session_id=?').get(sessionId))
  }

  recentGroupMessages(groupId: number, limit = 40): MessageRow[] { return this.listMessages(groupId, limit) }

  unreflectedMessages(groupId: number, limit = 80): MessageRow[] {
    const state = one<{ last_message_id: number }>(this.db.prepare('SELECT last_message_id FROM reflection_state WHERE group_id=?').get(groupId))
    const after = Number(state?.last_message_id || 0)
    return many<MessageRow>(this.db.prepare(`SELECT m.*,mem.platform_user_id,mem.display_name
      FROM messages m LEFT JOIN members mem ON mem.id=m.member_id
      WHERE m.group_id=? AND m.id>? ORDER BY m.id ASC LIMIT ?`).all(groupId, after, limit))
  }

  unreflectedCount(groupId: number): number {
    const state = one<{ last_message_id: number }>(this.db.prepare('SELECT last_message_id FROM reflection_state WHERE group_id=?').get(groupId))
    const row = one<{ n: number }>(this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE group_id=? AND id>?').get(groupId, Number(state?.last_message_id || 0)))
    return Number(row?.n || 0)
  }

  markReflected(groupId: number, messageId: number): void {
    this.db.prepare(`INSERT INTO reflection_state(group_id,last_message_id,last_reflected_at) VALUES(?,?,?)
      ON CONFLICT(group_id) DO UPDATE SET last_message_id=excluded.last_message_id,last_reflected_at=excluded.last_reflected_at`)
      .run(groupId, messageId, now())
  }

  memoryDocs(scopeType: MemoryScopeType, scopeKey: number): MemoryDocuments {
    const rows = many<{ doc_type: MemoryDocType; content: string; updated_at: number }>(
      this.db.prepare('SELECT doc_type,content,updated_at FROM memory_documents WHERE scope_type=? AND scope_key=?')
        .all(scopeType, scopeKey),
    )
    return Object.fromEntries(rows.map(row => [row.doc_type, row.content])) as MemoryDocuments
  }

  setMemoryDoc(scopeType: MemoryScopeType, scopeKey: number, docType: MemoryDocType, content: string): void {
    this.db.prepare(`INSERT INTO memory_documents(scope_type,scope_key,doc_type,content,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(scope_type,scope_key,doc_type) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at`)
      .run(scopeType, scopeKey, docType, String(content || ''), now())
  }

  appendMemoryDoc(scopeType: MemoryScopeType, scopeKey: number, docType: MemoryDocType, content: string, maxChars = 24_000): void {
    const current = this.memoryDocs(scopeType, scopeKey)[docType] || ''
    const joined = [current.trim(), String(content || '').trim()].filter(Boolean).join('\n')
    this.setMemoryDoc(scopeType, scopeKey, docType, joined.slice(-maxChars))
  }

  appendDailyDoc(scopeType: MemoryScopeType, scopeKey: number, date: string, note: string, maxChars = 24_000): void {
    const text = note.trim()
    if (!text) return
    const existing = this.memoryDocs(scopeType, scopeKey).daily || ''
    const entries = parseDailyEntries(existing)
    entries.push([date, text])
    this.setMemoryDoc(scopeType, scopeKey, 'daily', renderDailyEntries(entries).slice(-maxChars))
  }

  dailyEntries(scopeType: MemoryScopeType, scopeKey: number): DailyEntry[] {
    return parseDailyEntries(this.memoryDocs(scopeType, scopeKey).daily || '').map(([date, note]) => ({ date, note }))
  }

  setDailyEntries(scopeType: MemoryScopeType, scopeKey: number, entries: DailyEntry[]): void {
    this.setMemoryDoc(scopeType, scopeKey, 'daily', renderDailyEntries(entries.map(entry => [entry.date, entry.note])))
  }

  getChatSession(chatType: ChatType, rowId: number): string | null {
    const table = chatType === 'group' ? 'groups' : 'members'
    const row = one<{ dsh_session_id: string | null }>(this.db.prepare(`SELECT dsh_session_id FROM ${table} WHERE id=?`).get(rowId))
    return row?.dsh_session_id || null
  }

  setChatSession(chatType: ChatType, rowId: number, sessionId: string): void {
    const table = chatType === 'group' ? 'groups' : 'members'
    this.db.prepare(`UPDATE ${table} SET dsh_session_id=? WHERE id=?`).run(sessionId, rowId)
  }

  queueOutbox(accountId: number, chatType: ChatType, targetId: string, content: string, scheduledAt = now()): number {
    const result = this.db.prepare(`INSERT INTO outbox(account_id,chat_type,target_id,content,status,scheduled_at)
      VALUES(?,?,?,?, 'pending', ?)`).run(accountId, chatType, targetId, content, scheduledAt)
    return Number(result.lastInsertRowid)
  }

  dueOutbox(limit = 20): OutboxRow[] {
    return many<OutboxRow>(this.db.prepare(`SELECT * FROM outbox WHERE status='pending' AND scheduled_at<=? ORDER BY scheduled_at,id LIMIT ?`).all(now(), limit))
  }

  finishOutbox(id: number, error: string | null = null): void {
    this.db.prepare('UPDATE outbox SET status=?,sent_at=?,error=? WHERE id=?').run(error ? 'failed' : 'sent', now(), error, id)
  }
}
