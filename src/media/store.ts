import { randomUUID } from 'node:crypto'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { QQAttachmentInput, QQMediaKind, StoredAttachmentSummary } from '../types.js'
import type { QQChatDatabase } from '../storage/db.js'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_MESSAGE_BYTES = 100 * 1024 * 1024
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export class QQMediaStore {
  readonly root: string

  constructor(private readonly db: QQChatDatabase, private readonly ctx?: Context) {
    this.root = join(dirname(db.path), 'media')
  }

  async ingest(accountId: number, messageId: string, attachments: QQAttachmentInput[]): Promise<StoredAttachmentSummary[]> {
    const result: StoredAttachmentSummary[] = []
    let messageBytes = 0
    for (const input of attachments.slice(0, 12)) {
      try {
        const reusable = this.db.findReusableAttachment(accountId, messageId, input.platformFileId, input.kind)
        if (reusable?.localPath) {
          try {
            await access(reusable.localPath)
            this.db.extendAttachment(reusable.id, Date.now() + RETENTION_MS)
            result.push({ ...reusable, quoted: Boolean(input.quoted) })
            continue
          } catch {}
        }
        const downloaded = await this.download(input, messageBytes)
        if (!downloaded) continue
        messageBytes += downloaded.data.byteLength
        const id = `qqatt-${randomUUID()}`
        const extension = safeExtension(input.filename, input.contentType)
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        const path = join(this.root, `${id}${extension}`)
        await writeFile(path, downloaded.data, { mode: 0o600 })
        const imageRef = await this.saveImageRef(input, downloaded.data)
        const kind = input.kind || inferKind(input.contentType, input.filename)
        const summary: StoredAttachmentSummary = {
          id, kind, filename: safeFilename(input.filename), contentType: input.contentType,
          sizeBytes: downloaded.data.byteLength, quoted: Boolean(input.quoted), localPath: path, imageRef,
        }
        this.db.saveAttachment({ id, accountId, sourceMessageId: messageId, sourceFileId: input.platformFileId,
          kind, filename: summary.filename, contentType: input.contentType, sizeBytes: summary.sizeBytes,
          localPath: path, imageRef, expiresAt: Date.now() + RETENTION_MS })
        result.push(summary)
      } catch {
        // Media is optional input. The text turn must remain usable when a download fails.
      }
    }
    return result
  }

  async cleanup(): Promise<void> {
    const cutoff = Date.now() - RETENTION_MS
    this.db.expireAttachments(cutoff)
    for (const path of this.db.expiredAttachmentPaths(cutoff)) {
      try {
        await rm(path, { force: true })
        this.db.markAttachmentDeleted(path)
      } catch {
        // Keep the expired row for the next sweep if the physical object is busy.
      }
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  private async download(input: QQAttachmentInput, currentBytes: number): Promise<{ data: Uint8Array } | undefined> {
    const source = input.sourceUrl
    if (!source) return undefined
    let url = source
    for (let redirect = 0; redirect <= 3; redirect++) {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('QQ media URL must use HTTPS')
      await assertPublicHost(parsed.hostname)
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) return undefined
        url = new URL(location, url).toString()
        continue
      }
      if (!response.ok) return undefined
      const length = Number(response.headers.get('content-length') || 0)
      if (length > MAX_FILE_BYTES || currentBytes + length > MAX_MESSAGE_BYTES) throw new Error('QQ media size limit exceeded')
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > MAX_FILE_BYTES || currentBytes + data.byteLength > MAX_MESSAGE_BYTES) throw new Error('QQ media size limit exceeded')
      return { data }
    }
    return undefined
  }

  private async saveImageRef(input: QQAttachmentInput, data: Uint8Array): Promise<StoredAttachmentSummary['imageRef'] | undefined> {
    const service = (this.ctx as unknown as { attachments?: { saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<StoredAttachmentSummary['imageRef']> } } | undefined)?.attachments
    const mediaType = sniffImageType(data)
    if (!service || !mediaType) return undefined
    try { return await service.saveImage({ data, mediaType, name: safeFilename(input.filename) }) }
    catch { return undefined }
  }
}

async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map(item => item.address)
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new Error('QQ media URL resolves to a private address')
  }
}

function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address === '0.0.0.0' || address === '::') return true
  if (address.includes(':')) return address === '::1' || address.toLowerCase().startsWith('fc') || address.toLowerCase().startsWith('fd') || address.toLowerCase().startsWith('fe8') || address.toLowerCase().startsWith('fe9') || address.toLowerCase().startsWith('fea') || address.toLowerCase().startsWith('feb')
  const parts = address.split('.').map(Number)
  const [a, b] = parts
  return parts.length === 4 && (a === 10 || a === 127 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254))
}

function sniffImageType(data: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && new TextDecoder().decode(data.slice(0, 6)) === 'GIF89a') return 'image/gif'
  if (data.length >= 12 && new TextDecoder().decode(data.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(data.slice(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

function safeFilename(value: string): string { return basename(value || 'QQ附件').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 160) || 'QQ附件' }
function safeExtension(filename: string, contentType?: string): string {
  const ext = extname(filename).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12)
  if (ext) return ext.toLowerCase()
  const typeExtension = contentType?.split('/')[1]
  return typeExtension ? `.${typeExtension.replace(/[^a-zA-Z0-9]/g, '')}` : '.bin'
}
function inferKind(contentType?: string, filename = ''): QQMediaKind {
  const value = `${contentType || ''} ${filename}`.toLowerCase()
  if (value.includes('video') || /\.(mp4|mov|avi|mkv|webm)$/u.test(value)) return 'video'
  if (value.includes('audio') || /\.(mp3|wav|ogg|m4a|amr|silk)$/u.test(value)) return 'voice'
  if (value.includes('image') || /\.(png|jpe?g|gif|webp|bmp|heic)$/u.test(value)) return 'image'
  return 'file'
}
