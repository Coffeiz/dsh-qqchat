import test from 'node:test'
import assert from 'node:assert/strict'
import { messageMentionsBot, normalizeQQDispatch, renderQQMentionNames } from '../src/normalize.js'

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

test('extracts native QQ reply quote from message_scene and msg_elements', () => {
  const message = normalizeQQDispatch('C2C_MESSAGE_CREATE', {
    id: 'm2', content: '回复内容',
    author: { user_openid: 'u1' },
    message_scene: { ext: ['msg_idx=2', 'ref_msg_idx=1'] },
    msg_elements: [
      { msg_idx: '1', content: '被引用的原消息 &lt;内容&gt;' },
      { msg_idx: '2', content: '回复内容' },
    ],
  }, 7)
  assert.ok(message)
  assert.equal(message.quotedText, '被引用的原消息 <内容>')
})

test('renders QQ mention ids as display names when payload or member lookup provides one', () => {
  assert.equal(renderQQMentionNames('你好 <@!u2> @u3', {
    author: {},
    mentions: [{ id: 'u2', nickname: '小明' }, { id: 'u3' }],
  }, id => id === 'u3' ? '小红' : undefined), '你好 @小明 @小红')
})
