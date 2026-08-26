import assert from 'node:assert/strict'
import test from 'node:test'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { qqMessageContent } from '../src/session/agent-bridge.js'
import type { StoredAttachmentSummary } from '../src/types.js'

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
  assert.equal(content[1]?.type, 'image')
  assert.deepEqual(content[1], { type: 'image', attachment: imageRef })
})

test('QQ content is recognized by DSH as an image-bearing request', () => {
  const content = qqMessageContent('请描述这张图', [{
    id: 'qqatt-image', kind: 'image', filename: '截图.png', contentType: 'image/png',
    sizeBytes: 4, quoted: false, imageRef,
  }])
  assert.equal(contentHasImage(content), true)
})
