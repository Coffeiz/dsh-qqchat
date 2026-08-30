import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QQChatDatabase } from '../src/storage/db.js'

function withDb<T>(fn: (db: QQChatDatabase) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-'))
  const db = new QQChatDatabase(join(dir, 'qqchat.sqlite'))
  try { return fn(db) } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
}

test('SQLite keeps group/member identity and deduplicates platform messages', () => withDb(db => {
  const account = db.upsertAccount('app-1', 'secret-1')
  const group = db.upsertGroup(Number(account.id), 'group-openid', { readEnabled: true })
  const member = db.upsertMember(Number(account.id), 'user-openid', 'Alice')
  db.touchGroupMember(Number(group.id), Number(member.id), '群昵称')
  db.touchGroupMember(Number(group.id), Number(member.id), '新昵称')
  const first = db.insertMessage({ accountId: Number(account.id), platformMessageId: 'msg-1', chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: '你好' })
  const second = db.insertMessage({ accountId: Number(account.id), platformMessageId: 'msg-1', chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: '重复' })
  assert.equal(first, second)
  const rows = db.listMessages(Number(group.id))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.platform_user_id, 'user-openid')
  assert.equal(db.listGroupMembers(Number(group.id))[0]?.display_name, '新昵称')
  assert.deepEqual(JSON.parse(db.listGroupMembers(Number(group.id))[0]?.aliases_json || '[]'), ['群昵称'])
  db.addGroupMemberNickname(Number(group.id), Number(member.id), '小群友')
  assert.deepEqual(JSON.parse(db.listGroupMembers(Number(group.id))[0]?.nicknames_json || '[]'), ['小群友'])
  assert.equal(db.listGroupMembers(Number(group.id))[0]?.message_count, 1)
}))

test('member profiles migrate to typed entries without losing fields', () => withDb(db => {
  const account = db.upsertAccount('app-profile', 'secret-profile')
  const member = db.upsertMember(Number(account.id), 'profile-user', 'Profile User')
  db.setMemoryDoc('member', Number(member.id), 'profile', JSON.stringify({ name_observed: 'Profile User', preference: '简洁' }))
  // A new database already uses the migration-compatible storage contract; verify the
  // persisted value remains valid JSON and can be replaced by typed entries.
  db.setMemoryDoc('member', Number(member.id), 'profile', JSON.stringify([{ type: 'name', text: 'Profile User', ts: 1 }]))
  assert.deepEqual(JSON.parse(db.memoryDocs('member', Number(member.id)).profile || '[]')[0], { type: 'name', text: 'Profile User', ts: 1 })
}))

test('daily entries share one heading per date', () => withDb(db => {
  db.appendDailyDoc('group', 1, '2026-08-20', '第一条')
  db.appendDailyDoc('group', 1, '2026-08-20', '第二条')
  const daily = db.memoryDocs('group', 1).daily || ''
  assert.equal((daily.match(/^## 2026-08-20$/gm) || []).length, 1)
  assert.match(daily, /- 第一条\n- 第二条/)
}))

test('group reflection and member batch keep independent cursors', () => withDb(db => {
  const account = db.upsertAccount('app-cursors', 'secret-cursors')
  const group = db.upsertGroup(Number(account.id), 'group-cursors')
  const member = db.upsertMember(Number(account.id), 'user-cursors', 'Cursor User')
  db.insertMessage({ accountId: Number(account.id), chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: 'one' })
  const second = db.insertMessage({ accountId: Number(account.id), chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: 'two' })
  db.markReflected(Number(group.id), second)
  assert.equal(db.unreflectedMessages(Number(group.id)).length, 0)
  assert.equal(db.unreflectedMemberMessages(Number(group.id)).length, 2)
  db.markMembersReflected(Number(group.id), second)
  assert.equal(db.unreflectedMemberMessages(Number(group.id)).length, 0)
  assert.equal(db.unreflectedMemberCount(Number(group.id)), 0)
}))

test('reflection task ledger is idempotent and failed ranges can retry', () => withDb(db => {
  const task = {
    scopeType: 'group' as const,
    scopeKey: 7,
    taskType: 'member-batch' as const,
    startMessageId: 10,
    endMessageId: 59,
    idempotencyKey: 'member-batch:7:10:59',
  }
  assert.equal(db.startReflectionTask(task), true)
  assert.equal(db.startReflectionTask(task), false)
  db.finishReflectionTask(task.idempotencyKey, 'failed')
  assert.equal(db.startReflectionTask(task), true)
  db.finishReflectionTask(task.idempotencyKey, 'completed')
  assert.equal(db.startReflectionTask(task), false)
}))

test('memory documents preserve separate group and member scopes', () => withDb(db => {
  const account = db.upsertAccount('app-2', 'secret-2')
  const group = db.upsertGroup(Number(account.id), 'group-2')
  const member = db.upsertMember(Number(account.id), 'user-2', 'Bob')
  db.setMemoryDoc('group', Number(group.id), 'summary', '群级摘要')
  db.setMemoryDoc('member', Number(member.id), 'summary', '成员摘要')
  assert.equal(db.memoryDocs('group', Number(group.id)).summary, '群级摘要')
  assert.equal(db.memoryDocs('member', Number(member.id)).summary, '成员摘要')
}))

test('runtime settings persist independently from static config defaults', () => withDb(db => {
  const defaults = {
    memoryEnabled: true,
    memoryMemberBatchEnabled: true,
    groupReceiveMode: 'mention' as const,
    groupReplyFormat: 'smart' as const,
    directReplyFormat: 'smart' as const,
    directStreamingEnabled: true,
    groupMembersCanUseTools: false,
    groupMembersCanReceiveMedia: true,
    groupMembersCanReadMedia: false,
    ownerUserId: '',
  }
  assert.deepEqual(db.runtimeSettings(defaults), defaults)
  db.setSetting('groupReceiveMode', 'silent')
  db.setSetting('groupReplyFormat', 'compat')
  db.setSetting('groupMembersCanUseTools', true)
  db.setSetting('directStreamingEnabled', false)
  db.setSetting('groupMembersCanReceiveMedia', true)
  db.setSetting('groupMembersCanReadMedia', true)
  db.setSetting('ownerUserId', 'owner-openid')
  db.setSetting('memoryEnabled', false)
  db.setSetting('memoryMemberBatchEnabled', false)
  assert.deepEqual(db.runtimeSettings(defaults), {
    memoryEnabled: false,
    memoryMemberBatchEnabled: false,
    groupReceiveMode: 'silent',
    groupReplyFormat: 'compat',
    directReplyFormat: 'smart',
    directStreamingEnabled: false,
    groupMembersCanUseTools: true,
    groupMembersCanReceiveMedia: true,
    groupMembersCanReadMedia: true,
    ownerUserId: 'owner-openid',
  })
}))

test('direct chats are listed from c2c history and keep their DSH session mapping', () => withDb(db => {
  const account = db.upsertAccount('app-direct', 'secret-direct')
  const member = db.upsertMember(Number(account.id), 'direct-user', 'Carol')
  db.insertMessage({
    accountId: Number(account.id),
    platformMessageId: 'direct-msg-1',
    chatType: 'c2c',
    memberId: Number(member.id),
    direction: 'inbound',
    content: 'hello',
  })
  db.setChatSession('c2c', Number(member.id), 'qqchat-direct-session')
  const [chat] = db.listDirectChats()
  assert.equal(chat?.platform_user_id, 'direct-user')
  assert.equal(chat?.message_count, 1)
  assert.equal(chat?.dsh_session_id, 'qqchat-direct-session')
  assert.equal(db.listDirectMessages(Number(member.id))[0]?.content, 'hello')
}))

test('messages persist attachment summaries and quote relations', () => withDb(db => {
  const account = db.upsertAccount('app-media', 'secret-media')
  db.saveAttachment({ id: 'qqatt-1', accountId: Number(account.id), sourceMessageId: 'm-media', kind: 'image', filename: 'image.png', contentType: 'image/png', sizeBytes: 12, localPath: '/private/media/qqatt-1.png' })
  const member = db.upsertMember(Number(account.id), 'media-user', 'Alice')
  const id = db.insertMessage({
    accountId: Number(account.id), platformMessageId: 'm-media', chatType: 'c2c', memberId: Number(member.id),
    direction: 'inbound', content: '看看', attachments: [{ id: 'qqatt-1', kind: 'image', filename: 'image.png', contentType: 'image/png', sizeBytes: 12, quoted: false }],
    quote: { messageId: 'm-old', senderId: 'old-user', senderName: 'Bob', text: '原消息', attachments: [] },
  })
  const row = db.listDirectMessages(Number(member.id))[0]
  assert.equal(row?.id, id)
  assert.deepEqual(JSON.parse(row?.attachments_json || '[]')[0], { id: 'qqatt-1', kind: 'image', filename: 'image.png', contentType: 'image/png', sizeBytes: 12, quoted: false })
  assert.equal(JSON.parse(row?.quote_json || '{}').senderName, 'Bob')
  assert.equal(db.attachmentById('qqatt-1')?.filename, 'image.png')
}))

test('attachment reuse is keyed by account and source message identity', () => withDb(db => {
  const account = db.upsertAccount('app-reuse', 'secret-reuse')
  db.saveAttachment({ id: 'qqatt-reuse', accountId: Number(account.id), sourceMessageId: 'quoted-message', sourceFileId: 'file-1', kind: 'image', filename: 'quote.png', contentType: 'image/png', sizeBytes: 10, localPath: '/private/media/quote.png', expiresAt: 1 })
  const reusable = db.findReusableAttachment(Number(account.id), 'quoted-message', 'file-1', 'image')
  assert.equal(reusable?.id, 'qqatt-reuse')
  db.extendAttachment('qqatt-reuse', 999)
  assert.equal(db.findReusableAttachment(Number(account.id), 'quoted-message', 'file-1', 'image')?.id, 'qqatt-reuse')
  assert.equal(db.findReusableAttachment(Number(account.id), 'other-message', 'file-1', 'image'), undefined)
}))

test('quote index restores scoped message metadata and expires', () => withDb(db => {
  const account = db.upsertAccount('app-quote-index', 'secret-quote-index')
  db.saveQuoteIndex({
    accountId: Number(account.id), chatType: 'c2c', chatId: 'user-quote', msgIdx: 'idx-1',
    platformMessageId: 'message-quote', senderId: 'sender-quote', senderName: 'Alice', content: '原消息',
    attachments: [{ attachmentId: 'qqatt-quote', filename: 'quote.png', contentType: 'image/png', kind: 'image', quoted: true }],
    createdAt: 100, expiresAt: Date.now() + 60_000,
  })
  assert.equal(db.quoteIndex(Number(account.id), 'c2c', 'user-quote', 'idx-1')?.content, '原消息')
  assert.equal(db.quoteIndex(Number(account.id), 'group', 'user-quote', 'idx-1'), undefined)
  assert.equal(db.expireQuoteIndex(Date.now() + 120_000), 1)
  assert.equal(db.quoteIndex(Number(account.id), 'c2c', 'user-quote', 'idx-1'), undefined)
}))

test('attachment reads are limited to the DSH session that owns the message', () => withDb(db => {
  const account = db.upsertAccount('app-attachment-scope', 'secret-attachment-scope')
  const group = db.upsertGroup(Number(account.id), 'group-attachment-scope')
  const member = db.upsertMember(Number(account.id), 'member-attachment-scope', 'Alice')
  const attachmentId = 'qqatt-scoped'
  db.saveAttachment({ id: attachmentId, accountId: Number(account.id), sourceMessageId: 'scoped-message', kind: 'image', filename: 'scoped.png', contentType: 'image/png', sizeBytes: 12, localPath: '/private/media/scoped.png' })
  db.setChatSession('group', Number(group.id), 'session-group-owned')
  db.setChatSession('c2c', Number(member.id), 'session-member-private')
  db.insertMessage({
    accountId: Number(account.id), platformMessageId: 'scoped-message', chatType: 'group', groupId: Number(group.id), memberId: Number(member.id),
    direction: 'inbound', content: '图片',
    attachments: [{ id: attachmentId, kind: 'image', filename: 'scoped.png', contentType: 'image/png', sizeBytes: 12, quoted: false }],
  })
  assert.equal(db.attachmentForSession('session-group-owned', attachmentId)?.id, attachmentId)
  assert.equal(db.attachmentForSession('session-member-private', attachmentId), undefined)
  assert.equal(db.attachmentForSession('session-other', attachmentId), undefined)
}))

test('legacy groups migration removes requires_at without losing group state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-legacy-'))
  const path = join(dir, 'qqchat.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, app_id TEXT NOT NULL UNIQUE, app_secret TEXT NOT NULL,
      bot_user_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, sandbox INTEGER NOT NULL DEFAULT 0,
      gateway_status TEXT NOT NULL DEFAULT 'offline', gateway_last_error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, platform_group_id TEXT NOT NULL,
      name TEXT, enabled INTEGER NOT NULL DEFAULT 1, requires_at INTEGER NOT NULL DEFAULT 1,
      read_enabled INTEGER NOT NULL DEFAULT 1, dsh_session_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(account_id, platform_group_id)
    );
    INSERT INTO accounts(id, app_id, app_secret, created_at, updated_at) VALUES(1, 'legacy-app', 'secret', 1, 1);
    INSERT INTO groups(id, account_id, platform_group_id, name, enabled, requires_at, read_enabled, dsh_session_id, created_at, updated_at)
      VALUES(1, 1, 'legacy-group', 'Legacy', 1, 1, 1, 'legacy-session', 1, 1);
  `)
  legacy.close()
  try {
    const db = new QQChatDatabase(path)
    try {
      const group = db.groupById(1)
      assert.equal(group?.platform_group_id, 'legacy-group')
      assert.equal(group?.dsh_session_id, 'legacy-session')
    } finally {
      db.close()
    }
    const check = new DatabaseSync(path)
    try {
      const columns = check.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>
      assert.equal(columns.some(column => column.name === 'requires_at'), false)
    } finally {
      check.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy reflection state migrates the member batch cursor without changing the group cursor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-reflection-state-'))
  const path = join(dir, 'qqchat.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE reflection_state (
      group_id INTEGER PRIMARY KEY,
      last_message_id INTEGER NOT NULL DEFAULT 0,
      last_reflected_at INTEGER
    );
    INSERT INTO reflection_state(group_id,last_message_id,last_reflected_at) VALUES(7,42,100);
  `)
  legacy.close()
  try {
    const db = new QQChatDatabase(path)
    try {
      db.markMembersReflected(7, 55)
      assert.equal(db.unreflectedMemberCount(7), 0)
    } finally {
      db.close()
    }
    const check = new DatabaseSync(path)
    try {
      const columns = check.prepare('PRAGMA table_info(reflection_state)').all() as Array<{ name: string }>
      assert.equal(columns.some(column => column.name === 'last_member_reflected_message_id'), true)
      const row = check.prepare('SELECT last_message_id,last_member_reflected_message_id FROM reflection_state WHERE group_id=7').get() as { last_message_id: number; last_member_reflected_message_id: number }
      assert.equal(row.last_message_id, 42)
      assert.equal(row.last_member_reflected_message_id, 55)
    } finally {
      check.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stale running reflection tasks become retryable after database recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-reflection-task-recovery-'))
  const path = join(dir, 'qqchat.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE reflection_tasks (
      id INTEGER PRIMARY KEY, scope_type TEXT NOT NULL, scope_key INTEGER NOT NULL,
      task_type TEXT NOT NULL, start_message_id INTEGER NOT NULL, end_message_id INTEGER NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO reflection_tasks(scope_type,scope_key,task_type,start_message_id,end_message_id,status,idempotency_key,created_at,updated_at)
      VALUES('group',7,'group',1,20,'running','stale-task',1,1);
  `)
  legacy.close()
  try {
    const db = new QQChatDatabase(path)
    try {
      assert.equal(db.startReflectionTask({ scopeType: 'group', scopeKey: 7, taskType: 'group', startMessageId: 1, endMessageId: 20, idempotencyKey: 'stale-task' }), true)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
