import test from 'node:test'
import assert from 'node:assert/strict'
import { indexAttachments, mergeIndexedQuote, shouldReplyToGroup } from '../src/session/runtime.js'
import type { QQNormalizedMessage } from '../src/types.js'

const group = { enabled: 1 as const, read_enabled: 1 as const }

test('global auto mode replies for existing groups', () => {
  assert.equal(shouldReplyToGroup('auto', group, false), true)
})

test('global mention mode only replies when the bot is mentioned', () => {
  assert.equal(shouldReplyToGroup('mention', group, false), false)
  assert.equal(shouldReplyToGroup('mention', group, true), true)
})

test('global silent mode does not reply even when the bot is mentioned', () => {
  assert.equal(shouldReplyToGroup('silent', group, true), false)
})

test('disabled or unreadable groups never reply', () => {
  assert.equal(shouldReplyToGroup('auto', { enabled: 0, read_enabled: 1 }, false), false)
  assert.equal(shouldReplyToGroup('auto', { enabled: 1, read_enabled: 0 }, false), false)
})

test('indexed quote fills missing text and attachments without changing current text', () => {
  const message: QQNormalizedMessage = {
    platform: 'qq' as const, accountId: 1, chatType: 'c2c' as const, chatId: 'user-1', senderId: 'sender-2', senderName: 'Bob',
    messageId: 'current', msgIdx: 'current', refMsgIdx: 'old', text: '这张图是什么？', quotedText: '', attachments: [], mentioned: true,
    botMentionId: '', raw: {},
  }
  mergeIndexedQuote(message, {
    id: 1, accountId: 1, chatType: 'c2c', chatId: 'user-1', msgIdx: 'old', platformMessageId: 'old-message',
    senderId: 'sender-1', senderName: 'Alice', content: '请看看这张图',
    attachments: [{ attachmentId: 'qqatt-old', filename: 'old.png', contentType: 'image/png', kind: 'image' }],
    createdAt: 1, expiresAt: Date.now() + 60_000,
  })
  assert.equal(message.text, '这张图是什么？')
  assert.equal(message.quotedText, '请看看这张图')
  assert.equal(message.quote?.senderName, 'Alice')
  assert.equal(message.quote?.attachments[0]?.attachmentId, 'qqatt-old')
})

test('quote index metadata strips source URLs and maps stored attachment IDs', () => {
  const result = indexAttachments([
    { filename: 'image.png', sourceUrl: 'https://signed.example/image', platformFileId: 'file-1', kind: 'image' },
    { filename: 'image.png', sourceUrl: 'https://signed.example/image-2', platformFileId: 'file-2', kind: 'image' },
  ], [
    { id: 'qqatt-1', kind: 'image', filename: 'image.png', sizeBytes: 10, quoted: false, sourceFileId: 'file-1' },
    { id: 'qqatt-2', kind: 'image', filename: 'image.png', sizeBytes: 11, quoted: false, sourceFileId: 'file-2' },
  ])
  assert.equal(result[0]?.sourceUrl, undefined)
  assert.equal(result[0]?.attachmentId, 'qqatt-1')
  assert.equal(result[1]?.attachmentId, 'qqatt-2')
  assert.equal(result[0]?.platformFileId, 'file-1')
})

test('attachment mapping never uses a compacted ordinal after an earlier download fails', () => {
  const result = indexAttachments([
    { filename: 'failed.png', kind: 'image' },
    { filename: 'kept.png', kind: 'image' },
  ], [{ id: 'qqatt-kept', kind: 'image', filename: 'kept.png', sizeBytes: 10, quoted: false, sourceIndex: 1 }])
  assert.equal(result[0]?.attachmentId, undefined)
  assert.equal(result[1]?.attachmentId, 'qqatt-kept')
})
