import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AccountRow,
  AuthTaskRow,
  ChatType,
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
} from './types.js'

const now = (): number => Date.now()

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
        requires_at INTEGER NOT NULL DEFAULT 1,
        read_enabled INTEGER NOT NULL DEFAULT 1,
        dsh_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, platform_group_id)
      );
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
        raw_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS messages_platform_unique
        ON messages(account_id, platform_message_id, direction)
        WHERE platform_message_id IS NOT NULL AND platform_message_id <> '';
      CREATE INDEX IF NOT EXISTS messages_group_created ON messages(group_id, created_at, id);
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

  upsertGroup(accountId: number, platformGroupId: string, defaults: GroupDefaults = {}): GroupRow {
    const t = now()
    this.db.prepare(`INSERT INTO groups(account_id,platform_group_id,name,enabled,requires_at,read_enabled,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id,platform_group_id) DO UPDATE SET updated_at=excluded.updated_at`)
      .run(accountId, platformGroupId, defaults.name || null, defaults.enabled === false ? 0 : 1,
        defaults.requiresAt === false ? 0 : 1, defaults.readEnabled === false ? 0 : 1, t, t)
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
      requires_at: patch.requiresAt === undefined ? row.requires_at : patch.requiresAt ? 1 : 0,
      read_enabled: patch.readEnabled === undefined ? row.read_enabled : patch.readEnabled ? 1 : 0,
    }
    this.db.prepare('UPDATE groups SET name=?,enabled=?,requires_at=?,read_enabled=?,updated_at=? WHERE id=?')
      .run(next.name, next.enabled, next.requires_at, next.read_enabled, now(), id)
    return this.groupById(id)
  }

  listGroups(): GroupListRow[] {
    return many<GroupListRow>(this.db.prepare(`SELECT g.*,
      (SELECT MAX(created_at) FROM messages m WHERE m.group_id=g.id) AS last_message_at,
      (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id) AS member_count,
      (SELECT COUNT(*) FROM messages m WHERE m.group_id=g.id) AS message_count
      FROM groups g ORDER BY COALESCE(last_message_at,g.updated_at) DESC`).all())
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
    this.db.prepare(`INSERT INTO group_members(group_id,member_id,display_name,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?) ON CONFLICT(group_id,member_id) DO UPDATE SET
      display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE group_members.display_name END,
      last_seen_at=excluded.last_seen_at`).run(groupId, memberId, displayName, t, t)
  }

  listGroupMembers(groupId: number): GroupMemberRow[] {
    return many<GroupMemberRow>(this.db.prepare(`SELECT m.id,m.platform_user_id,m.display_name AS global_display_name,
      COALESCE(NULLIF(gm.display_name,''),m.display_name) AS display_name, gm.first_seen_at,gm.last_seen_at
      FROM group_members gm JOIN members m ON m.id=gm.member_id WHERE gm.group_id=? ORDER BY gm.last_seen_at DESC`).all(groupId))
  }

  insertMessage(input: InsertMessageInput): number {
    if (input.platformMessageId) {
      const existing = one<{ id: number }>(this.db.prepare(`SELECT id FROM messages WHERE account_id=? AND platform_message_id=? AND direction=?`)
        .get(input.accountId, input.platformMessageId, input.direction))
      if (existing) return Number(existing.id)
    }
    const result = this.db.prepare(`INSERT INTO messages(account_id,platform_message_id,chat_type,group_id,member_id,direction,
      content,quoted_text,mentioned,created_at,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.accountId, input.platformMessageId || null, input.chatType, input.groupId || null,
        input.memberId || null, input.direction, input.content || '', input.quotedText || null,
        input.mentioned ? 1 : 0, input.createdAt || now(), input.raw ? JSON.stringify(input.raw) : null)
    return Number(result.lastInsertRowid)
  }

  listMessages(groupId: number, limit = 100): MessageRow[] {
    const rows = many<MessageRow>(this.db.prepare(`SELECT m.*,mem.platform_user_id,mem.display_name
      FROM messages m LEFT JOIN members mem ON mem.id=m.member_id
      WHERE m.group_id=? ORDER BY m.id DESC LIMIT ?`).all(groupId, limit))
    return rows.reverse()
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
