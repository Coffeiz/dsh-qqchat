import { createDecipheriv } from 'node:crypto'

/** QQ bind_task returns base64(iv[12] + ciphertext + gcmTag[16]). */
export function decryptQQSecret(encryptedBase64, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64')
  const raw = Buffer.from(encryptedBase64, 'base64')
  if (key.length !== 32) throw new Error('QQ bind AES key must be 32 bytes')
  if (raw.length < 28) throw new Error('QQ bind ciphertext is too short')
  const iv = raw.subarray(0, 12)
  const body = raw.subarray(12)
  const tag = body.subarray(body.length - 16)
  const ciphertext = body.subarray(0, body.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
