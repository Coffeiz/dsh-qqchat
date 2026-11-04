import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { migrateQQChatSessions, type QQChatPersistence } from '../src/migrations/qqchat-display-events.js'

test('legacy QQ surface messages before the DSH head migrate into passive QQ bubbles', async () => {
  const fixture = await createFixture([
    {
      type: 'user/message', time: 100,
      data: {
        id: 'input-1', role: 'user',
        source: { kind: 'user', channel: 'qq', chatType: 'c2c', chatId: 'chat-1', senderId: 'owner-1', senderName: 'Owner', messageId: 'message-1', mentioned: false },
        content: [{ type: 'text', text: '[当前 QQ 私聊消息]\n正文:\n你好' }],
      },
    },
    { type: 'system/message', time: 101, data: { source: { kind: 'system' }, content: [{ type: 'text', text: 'head' }] } },
    { type: 'step/start', time: 102, data: {} },
  ], 0)
  try {
    const result = await migrateQQChatSessions(fixture.persistence, {})
    assert.deepEqual(result, { sessions: 1, migratedEvents: 1, failedSessions: 0, deferredSessions: 0 })

    const events = await fixture.readCurrentEvents()
    assert.equal(events[0]?.type, 'plugin:qqchat/message')
    assert.equal(events[0]?.ignorable, true)
    assert.equal((events[0]?.data as { content?: string }).content, '你好')
    assert.equal((events[0]?.data as { isOwner?: boolean }).isOwner, true)
    assert.equal((events[0]?.data as { legacyMessage?: unknown }).legacyMessage !== undefined, true)
    assert.equal(events[1]?.type, 'system/message')
    assert.ok((await readdir(fixture.sessionDir)).some(name => name.includes('qqchat-backup-')))
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('migrated group-member messages keep the sender name and incoming bubble identity', async () => {
  const fixture = await createFixture([
    {
      type: 'user/message', time: 100,
      data: {
        id: 'input-2', role: 'user',
        source: { kind: 'user', channel: 'qq', chatType: 'group', chatId: 'group-1', senderId: 'member-1', senderName: '群友昵称', messageId: 'message-2', mentioned: false },
        content: [{ type: 'text', text: '[当前 QQ 群聊消息]\n正文:\n群友发言' }],
      },
    },
    { type: 'system/message', time: 101, data: { source: { kind: 'system' }, content: [{ type: 'text', text: 'head' }] } },
    { type: 'step/start', time: 102, data: {} },
  ], 0)
  try {
    await migrateQQChatSessions(fixture.persistence, {})
    const events = await fixture.readCurrentEvents()
    const display = events[0]?.data as { chatType?: string; direction?: string; senderName?: string; isOwner?: boolean; content?: string }
    assert.equal(events[0]?.type, 'plugin:qqchat/message')
    assert.equal(display.chatType, 'group')
    assert.equal(display.direction, 'inbound')
    assert.equal(display.senderName, '群友昵称')
    assert.equal(display.isOwner, undefined)
    assert.equal(display.content, '群友发言')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('non-QQ surface events before the DSH head stay untouched and are reported as deferred', async () => {
  const fixture = await createFixture([
    { type: 'assistant/message', seq: 0, time: 100, data: { source: { kind: 'assistant' }, content: [{ type: 'text', text: 'legacy' }] } },
    { type: 'step/start', seq: 1, time: 101, data: {} },
  ], 3)
  try {
    const before = await readFile(fixture.legacyPath)
    const result = await migrateQQChatSessions(fixture.persistence, {})
    assert.deepEqual(result, { sessions: 1, migratedEvents: 0, failedSessions: 0, deferredSessions: 1 })
    assert.deepEqual(await readFile(fixture.legacyPath), before)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function createFixture(events: readonly Record<string, unknown>[], version = 3) {
  const root = await mkdtemp(join(tmpdir(), 'qqchat-session-migration-'))
  const sessionId = 'qqchat-migration-test'
  const sessionDir = join(root, 'project', sessionId)
  await mkdir(sessionDir, { recursive: true })
  const legacyPath = join(sessionDir, version === 0 ? 'session.jsonl' : `session.v${version}.jsonl`)
  const currentPath = join(sessionDir, 'session.v4.jsonl')
  const encode = (version: number, rows: readonly Record<string, unknown>[]) => [
    JSON.stringify({ type: 'session', id: sessionId, version }),
    ...rows.map(row => JSON.stringify(row)),
    '',
  ].join('\n')
  await writeFile(legacyPath, encode(version, events))

  const persistence: QQChatPersistence = {
    async list() {
      return [{ header: { id: sessionId }, location: { kind: 'jsonl', path: legacyPath } }]
    },
    async open(_id: SessionId, _access: 'write') {
      const text = await readFile(legacyPath, 'utf8')
      const lines = text.trimEnd().split('\n')
      const staged = lines.slice(1).map((line, seq) => {
        const event = JSON.parse(line) as Record<string, unknown>
        return typeof event.seq === 'number' ? event : { ...event, seq }
      })
      const firstSurface = staged.find(event => ['system/message', 'user/message', 'assistant/message', 'tool/result'].includes(String(event.type)))
      assert.equal(firstSurface?.type, 'system/message', 'QQ surface copies must be hidden from DSH format migration')
      await writeFile(currentPath, encode(4, staged))
      return { async close() {} }
    },
    async stat() {
      return { header: { id: sessionId }, location: { kind: 'jsonl', path: currentPath } }
    },
  }
  return {
    root,
    sessionDir,
    legacyPath,
    persistence,
    async readCurrentEvents() {
      const text = await readFile(currentPath, 'utf8')
      return text.trimEnd().split('\n').slice(1).map(line => JSON.parse(line) as Record<string, unknown>)
    },
  }
}
