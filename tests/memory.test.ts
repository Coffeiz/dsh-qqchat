import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QQChatDatabase } from '../src/storage/db.js'
import { MemoryEngine } from '../src/storage/memory.js'
import { resolveConfig } from '../src/config.js'
import {
  memberBatchMemorySystemPrompt,
  memberCompressionSystemPrompt,
  memorySystemPrompt,
  groupCompressionSystemPrompt,
  parseJsonObject,
  privateMemorySystemPrompt,
  validateMemberBatchPayload,
  MEMORY_INJECT_CHARS,
} from '../src/storage/memory.js'

test('memory reflection prompts preserve Gugu-style scope and evidence boundaries', () => {
  const groupPrompt = memorySystemPrompt()
  assert.match(groupPrompt, /消息发送者不等于语义主体/)
  assert.match(groupPrompt, /不要输出 members/)
  assert.match(groupPrompt, /绝对日期/)

  const memberPrompt = memberBatchMemorySystemPrompt()
  assert.match(memberPrompt, /宁可漏记，也不要错记/)
  assert.match(memberPrompt, /只能包含 messages 里真实作为发送者出现/)
  assert.match(memberPrompt, /profile_add\/profile_remove/)

  const privatePrompt = privateMemorySystemPrompt()
  assert.match(privatePrompt, /direction=inbound/)
  assert.match(privatePrompt, /direction=outbound 的 BOT 消息只是对话上下文/)
  assert.match(privatePrompt, /只包含本轮新增或明确修正/)

  assert.match(groupCompressionSystemPrompt(), /不能清空已有长期记忆/)
  assert.match(memberCompressionSystemPrompt(), /不要把群组信息或其他人的属性写入当前成员记忆/)
})

test('memory reflection parser accepts fenced JSON and surrounding prose', () => {
  const json = JSON.stringify({ summary: '保留"引号"' })
  const parsed = parseJsonObject('这是整理结果：\n```json\n' + json + '\n```\n以上。') as { summary: string }
  assert.equal(parsed.summary, '保留"引号"')
})

test('memory reflection parser ignores model thinking wrappers', () => {
  const parsed = parseJsonObject('<think>先分析消息，不要把这段当作结果</think>\n{"summary":"有效结果"}') as { summary: string }
  assert.equal(parsed.summary, '有效结果')
})

test('memory reflection parser rejects non-object output', () => {
  assert.throws(() => parseJsonObject('没有 JSON'), /没有返回有效 JSON/)
  assert.throws(() => parseJsonObject('[]'), /没有返回有效 JSON/)
})

test('memory context follows Gugu-style per-scope injection budgets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-memory-context-'))
  const db = new QQChatDatabase(join(dir, 'qqchat.sqlite'))
  try {
    const account = db.upsertAccount('app-memory-context', 'secret-memory-context')
    const group = db.upsertGroup(Number(account.id), 'group-memory-context')
    const member = db.upsertMember(Number(account.id), 'user-memory-context', 'Context User')
    const engine = new MemoryEngine({} as never, db, resolveConfig())

    db.setMemoryDoc('group', Number(group.id), 'profile', 'G'.repeat(2500))
    db.setMemoryDoc('group', Number(group.id), 'daily', 'old-group-' + 'D'.repeat(2500))
    db.setMemoryDoc('member', Number(member.id), 'profile', 'M'.repeat(2500))
    db.setMemoryDoc('member', Number(member.id), 'daily', 'old-member-' + 'E'.repeat(2500))

    const groupContext = engine.contextForGroup(group, {
      id: Number(member.id),
      platform_user_id: 'user-memory-context',
      display_name: 'Context User',
    })
    const groupScope = groupContext.slice(groupContext.indexOf('[群画像]'), groupContext.indexOf('当前成员ID='))
    const memberScope = groupContext.slice(groupContext.indexOf('[当前成员画像]'))
    assert.ok(groupScope.length <= MEMORY_INJECT_CHARS + 20)
    assert.ok(memberScope.length <= MEMORY_INJECT_CHARS + 30)

    db.setMemoryDoc('member', Number(member.id), 'profile', '')
    db.setMemoryDoc('member', Number(member.id), 'daily', 'old-' + 'X'.repeat(2500) + '-latest-member')
    const privateContext = engine.contextForMember({ id: Number(member.id), platform_user_id: 'user-memory-context', display_name: 'Context User' })
    const dailyStart = privateContext.indexOf('[成员近期沉淀]')
    const dailyEnd = privateContext.indexOf('[成员长期记忆]')
    const daily = privateContext.slice(dailyStart, dailyEnd < 0 ? undefined : dailyEnd)
    assert.ok(daily.length > 0)
    assert.match(daily, /latest-member/)
    assert.ok(!daily.includes('old-'))
    engine.dispose()
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('member batch output accepts only unique members from the current message scope', () => {
  const allowed = new Set(['user-a', 'user-b'])
  assert.equal(validateMemberBatchPayload({ members: [{ senderId: 'user-a' }, { senderId: 'user-b' }] }, allowed), true)
  assert.equal(validateMemberBatchPayload({ members: [{ senderId: 'other-user' }] }, allowed), false)
  assert.equal(validateMemberBatchPayload({ members: [{ senderId: 'user-a' }, { senderId: 'user-a' }] }, allowed), false)
  assert.equal(validateMemberBatchPayload({ members: [{ senderId: 1 }] }, allowed), false)
})

test('group reflection keeps member documents out of the group task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-memory-'))
  const db = new QQChatDatabase(join(dir, 'qqchat.sqlite'))
  const requests: unknown[] = []
  let call = 0
  const ctx = {
    llm: {
      stream: async function* (options: { messages: Array<{ content: Array<{ text?: string }> }> }) {
        requests.push(JSON.parse(options.messages[0]?.content[0]?.text || '{}'))
        call += 1
        const output = call === 1
          ? { group: { summary: '群体摘要' }, members: [{ senderId: 'user-a', summary: '不应被群反思写入' }] }
          : { members: [{ senderId: 'user-a', summary: '成员摘要' }] }
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify(output) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      },
    },
  }
  try {
    const account = db.upsertAccount('app-memory-engine', 'secret-memory-engine')
    const group = db.upsertGroup(Number(account.id), 'group-memory-engine')
    const member = db.upsertMember(Number(account.id), 'user-a', 'Alice')
    db.touchGroupMember(Number(group.id), Number(member.id), 'Alice')
    db.insertMessage({ accountId: Number(account.id), chatType: 'group', groupId: Number(group.id), memberId: Number(member.id), direction: 'inbound', content: '群消息' })
    const engine = new MemoryEngine(ctx as never, db, resolveConfig({ reflectionIdleMs: 1 }))
    engine.setRoute(Number(group.id), 'test', 'test-model', 'group-session')
    await engine.reflectNow(Number(group.id))
    assert.equal(db.memoryDocs('group', Number(group.id)).summary, '群体摘要')
    assert.equal(db.memoryDocs('member', Number(member.id)).summary, undefined)
    assert.equal((requests[0] as { existing?: { members?: unknown } }).existing?.members, undefined)
    await engine.reflectMembersNow(Number(group.id))
    assert.equal(db.memoryDocs('member', Number(member.id)).summary, '成员摘要')
    engine.dispose()
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('private reflection keeps user and bot directions in a private-owner task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-private-memory-'))
  const db = new QQChatDatabase(join(dir, 'qqchat.sqlite'))
  let request: unknown
  const ctx = {
    llm: {
      stream: async function* (options: { messages: Array<{ content: Array<{ text?: string }> }> }) {
        request = JSON.parse(options.messages[0]?.content[0]?.text || '{}')
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ summary: '私聊摘要', daily: '用户目标' }) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      },
    },
  }
  try {
    const account = db.upsertAccount('app-private-memory', 'secret-private-memory')
    const member = db.upsertMember(Number(account.id), 'private-user', 'Private User')
    db.insertMessage({ accountId: Number(account.id), chatType: 'c2c', memberId: Number(member.id), direction: 'inbound', content: '我是用户' })
    db.insertMessage({ accountId: Number(account.id), chatType: 'c2c', memberId: Number(member.id), direction: 'outbound', content: '我是机器人' })
    const engine = new MemoryEngine(ctx as never, db, resolveConfig({ reflectionIdleMs: 1 }), console)
    engine.setMemberRoute(Number(member.id), 'test', 'test-model', 'private-session')
    await engine.reflectMemberNow(Number(member.id))
    const messages = (request as { messages: Array<{ direction: string; senderId: string }> }).messages
    assert.deepEqual(messages.map(message => [message.direction, message.senderId]), [['inbound', 'private-user'], ['outbound', 'BOT']])
    assert.equal(db.memoryDocs('member', Number(member.id)).summary, '私聊摘要')
    engine.dispose()
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
