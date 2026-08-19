import test from 'node:test'
import assert from 'node:assert/strict'
import { messageMentionsBot, normalizeQQDispatch } from '../src/normalize.js'

test('group identity prefers user_openid over member_openid and nickname', () => {
  const message = normalizeQQDispatch('GROUP_AT_MESSAGE_CREATE', {
    id: 'm1', group_openid: 'g1', content: ' hello ',
    author: { user_openid: 'u-stable', member_openid: 'member-fallback', username: '随时会改的昵称' },
    mentions: [{ bot: true, is_you: true, id: 'bot-id' }],
  }, 7)
  assert.ok(message)
  assert.equal(message.senderId, 'u-stable')
  assert.equal(message.senderName, '随时会改的昵称')
  assert.equal(message.groupOpenid, 'g1')
  assert.equal(message.mentioned, true)
})

test('is_you=false does not count as mentioning this bot', () => {
  assert.equal(messageMentionsBot({ mentions: [{ bot: true, is_you: false }] }, 'GROUP_AT_MESSAGE_CREATE'), false)
})

test('legacy GROUP_AT event without mentions falls back to mentioned', () => {
  assert.equal(messageMentionsBot({}, 'GROUP_AT_MESSAGE_CREATE'), true)
})