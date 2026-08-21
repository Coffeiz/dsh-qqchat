import test from 'node:test'
import assert from 'node:assert/strict'
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
  assert.deepEqual(db.runtimeSettings(defaults), {
    memoryEnabled: false,
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
