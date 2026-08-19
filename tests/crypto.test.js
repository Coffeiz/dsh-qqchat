import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createCipheriv } from 'node:crypto'
import { decryptQQSecret } from '../src/crypto.js'

test('decryptQQSecret matches QQ bind_task AES-256-GCM framing', () => {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = 'qq-secret-测试'
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const encrypted = Buffer.concat([iv, ciphertext, tag]).toString('base64')
  assert.equal(decryptQQSecret(encrypted, key.toString('base64')), plaintext)
})
