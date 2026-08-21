import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QQMediaStore } from '../src/media/store.js'
import { QQChatDatabase } from '../src/storage/db.js'

test('media ingest reuses an indexed attachment by attachment ID without downloading', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqchat-media-'))
  const db = new QQChatDatabase(join(dir, 'qqchat.sqlite'))
  const localPath = join(dir, 'stored.png')
  writeFileSync(localPath, 'stored')
  try {
    const account = db.upsertAccount('app-media-index', 'secret-media-index')
    db.saveAttachment({ id: 'qqatt-indexed', accountId: Number(account.id), sourceMessageId: 'old-message', kind: 'image', filename: 'stored.png', contentType: 'image/png', sizeBytes: 6, localPath, expiresAt: Date.now() + 60_000 })
    const store = new QQMediaStore(db)
    const result = await store.ingest(Number(account.id), 'old-message', [{ attachmentId: 'qqatt-indexed', filename: 'stored.png', kind: 'image', quoted: true }])
    assert.equal(result.length, 1)
    assert.equal(result[0]?.id, 'qqatt-indexed')
    assert.equal(result[0]?.quoted, true)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
