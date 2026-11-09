import assert from 'node:assert/strict'
import test from 'node:test'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { qqIncomingMessageSource, qqMessageContent, qqMessageContextText } from '../src/session/agent-bridge.js'
import type { QQNormalizedMessage, StoredAttachmentSummary } from '../src/types.js'

const imageRef = {
  attachmentId: 'sha256:test-image' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
} satisfies ImageAttachmentRef

test('QQ image turns remain native DSH image blocks before model dispatch', () => {
  const attachments: StoredAttachmentSummary[] = [{
    id: 'qqatt-image', kind: 'image', filename: '截图.png', contentType: 'image/png',
    sizeBytes: 4, quoted: false, imageRef,
  }]

  const content = qqMessageContent('请描述这张图', attachments)
  assert.equal(content[0]?.type, 'text')
  assert.equal(content[0]?.type === 'text' ? content[0].text : '', '请描述这张图')
  assert.equal(content[1]?.type, 'image')
  assert.deepEqual(content[1], { type: 'image', attachment: imageRef })
})

test('QQ native user bubble contains only the body; identity and attachment metadata stay in context', () => {
  const message: QQNormalizedMessage = {
    platform: 'qq', accountId: 1, chatType: 'c2c', chatId: 'chat-1', senderId: 'owner-1', senderName: 'Coffeiz',
    messageId: 'message-2', msgIdx: 'message-2', refMsgIdx: '', text: '机器状态怎样', quotedText: '',
    attachments: [], mentioned: true, botMentionId: '', raw: {},
  }
  const attachments: StoredAttachmentSummary[] = [{
    id: 'attachment-1', kind: 'image', filename: 'status.png', sizeBytes: 10, quoted: false, imageRef,
  }]
  const bubble = qqMessageContent(message.text, attachments)
  const context = qqMessageContextText(message, attachments)

  assert.equal(bubble[0]?.type === 'text' ? bubble[0].text : '', '机器状态怎样')
  assert.equal(context.includes('【私聊消息】'), true)
  assert.equal(context.includes('平台 ID：owner-1'), true)
  assert.equal(context.includes('显示名：Coffeiz'), true)
  assert.equal(context.includes('是否@机器人：是'), true)
  assert.equal(context.includes('【消息时间】'), true)
  assert.equal(context.includes('【消息正文】'), true)
  assert.equal(context.includes('正文由紧随其后的 DSH 用户消息承载。'), true)
  assert.equal(context.includes('attachment_id=attachment-1'), true)
  assert.equal(context.includes('机器状态怎样'), false)
})

test('QQ content is recognized by DSH as an image-bearing request', () => {
  const content = qqMessageContent('请描述这张图', [{
    id: 'qqatt-image', kind: 'image', filename: '截图.png', contentType: 'image/png',
    sizeBytes: 4, quoted: false, imageRef,
  }])
  assert.equal(contentHasImage(content), true)
})

test('private and owner QQ messages use native user bubbles; other group senders stay notices', () => {
  const message = (chatType: QQNormalizedMessage['chatType']): QQNormalizedMessage => ({
    platform: 'qq', accountId: 1, chatType, chatId: 'chat-1', senderId: 'sender-1', senderName: 'Alice',
    messageId: 'message-1', msgIdx: 'message-1', refMsgIdx: '', text: 'hello', quotedText: '',
    attachments: [], mentioned: true, botMentionId: '', raw: {},
  })
  const privateSource = qqIncomingMessageSource(message('c2c'), false)
  const ownerSource = qqIncomingMessageSource(message('group'), true)
  const memberSource = qqIncomingMessageSource(message('group'), false)

  assert.equal(privateSource.kind, 'user')
  assert.equal(privateSource.channel, 'qq')
  assert.equal(privateSource.senderId, 'sender-1')
  assert.equal(ownerSource.kind, 'user')
  assert.equal(memberSource.kind, 'qq-chat')
  assert.equal(memberSource.form, 'notice')
})
