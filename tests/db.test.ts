import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QQChatDatabase } from '../src/db.js'

function withDb<T>(fn: (db: QQChatDatabase) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-'))
  const db = new QQChatDatabase(join(dir, 'qqchat.sqlite'))
  try { return fn(db) } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
}

test('SQLite keeps group/member identity and deduplicates platform messages', () => withDb(db => {
  const account = db.upsertAccount('app-1', 'secret-1')
  const group = db.upsertGroup(Number(account.id), 'group-openid', { requiresAt: true, readEnabled: true })
  const member = db.upsertMember(Number(account.id), 'user-openid', 'Alice')
  db.touchGroupMember(Number(group.id), Number(member.id), '群昵称')
  const first = db.insertMessage({ accountId: Number(account.id), platformMessageId: 'msg-1', chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: '你好' })
  const second = db.insertMessage({ accountId: Number(account.id), platformMessageId: 'msg-1', chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: '重复' })
  assert.equal(first, second)
  const rows = db.listMessages(Number(group.id))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.platform_user_id, 'user-openid')
  assert.equal(db.listGroupMembers(Number(group.id))[0]?.display_name, '群昵称')
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
    groupReceiveMode: 'mention' as const,
    replyFormat: 'smart' as const,
    groupMembersCanUseTools: false,
    ownerUserId: '',
  }
  assert.deepEqual(db.runtimeSettings(defaults), defaults)
  db.setSetting('groupReceiveMode', 'silent')
  db.setSetting('replyFormat', 'compat')
  db.setSetting('groupMembersCanUseTools', true)
  db.setSetting('ownerUserId', 'owner-openid')
  assert.deepEqual(db.runtimeSettings(defaults), {
    groupReceiveMode: 'silent',
    replyFormat: 'compat',
    groupMembersCanUseTools: true,
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
