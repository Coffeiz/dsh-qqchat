import type { QQAttachmentInput, QQAuthor, QQDispatchData, QQNormalizedMessage, QQQuoteInput, QQMediaKind } from '../types.js'

function authorId(author: QQAuthor = {}): string {
  return String(author.user_openid || author.member_openid || author.id || '')
}

function authorName(author: QQAuthor = {}): string {
  return String(author.username || author.nickname || '').trim()
}

/** Replace QQ's stable mention tokens with the best known display name. */
export function renderQQMentionNames(
  text: string,
  data: QQDispatchData,
  lookup: (platformUserId: string) => string | undefined = () => undefined,
): string {
  const mentions = Array.isArray(data.mentions) ? data.mentions : []
  let rendered = String(text || '')
  for (const item of mentions) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.user_openid || item.member_openid || item.openid || item.id || '').trim()
    if (!id) continue
    const name = String(item.username || item.nickname || item.display_name || item.name || lookup(id) || '').trim()
    if (!name) continue
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    rendered = rendered
      .replace(new RegExp(`<@!?${escaped}>`, 'g'), `@${name}`)
      .replace(new RegExp(`@${escaped}(?![A-Za-z0-9_-])`, 'g'), `@${name}`)
  }
  return rendered
}

export function messageMentionsBot(data: QQDispatchData, eventType: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(data, 'mentions')) {
    return eventType === 'GROUP_AT_MESSAGE_CREATE'
  }
  const mentions = data.mentions
  if (!Array.isArray(mentions)) return false
  if (mentions.length === 0) return eventType === 'GROUP_AT_MESSAGE_CREATE'
  for (const item of mentions) {
    if (!item || typeof item !== 'object' || item.bot !== true) continue
    if (Object.prototype.hasOwnProperty.call(item, 'is_you')) return item.is_you === true
    return true
  }
  return false
}

export function botMentionId(data: QQDispatchData, eventType: string): string {
  const mentions = data.mentions
  if (Array.isArray(mentions)) {
    for (const item of mentions) {
      if (!item || typeof item !== 'object' || item.bot !== true) continue
      for (const key of ['id', 'user_openid', 'member_openid', 'openid'] as const) {
        if (item[key]) return String(item[key])
      }
    }
  }
  if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
    const match = String(data.content || '').match(/<@!?([^>]+)>/)
    if (match?.[1]) return match[1]
  }
  return ''
}

export function normalizeQQDispatch(
  eventType: string,
  data: QQDispatchData | undefined,
  accountId: number,
): QQNormalizedMessage | undefined {
  if (!data || typeof data !== 'object') return undefined
  if (eventType === 'C2C_MESSAGE_CREATE') {
    const senderId = authorId(data.author)
    if (!senderId) return undefined
    return {
      platform: 'qq', accountId, chatType: 'c2c', chatId: senderId,
      senderId, senderName: authorName(data.author), groupOpenid: undefined,
      messageId: String(data.id || ''), msgIdx: messageSceneIndex(data), refMsgIdx: messageReferenceIndex(data), text: String(data.content || '').trim(),
      quotedText: extractQuotedText(data), quote: extractQuote(data), attachments: extractAttachments(data), mentioned: true,
      botMentionId: '', raw: data,
    }
  }
  if (eventType === 'GROUP_AT_MESSAGE_CREATE' || eventType === 'GROUP_MESSAGE_CREATE') {
    const senderId = authorId(data.author)
    const groupOpenid = String(data.group_openid || '')
    if (!senderId || !groupOpenid) return undefined
    return {
      platform: 'qq', accountId, chatType: 'group', chatId: groupOpenid,
      senderId, senderName: authorName(data.author), groupOpenid,
      messageId: String(data.id || ''), msgIdx: messageSceneIndex(data), refMsgIdx: messageReferenceIndex(data), text: String(data.content || '').trim(),
      quotedText: extractQuotedText(data), quote: extractQuote(data), attachments: extractAttachments(data), mentioned: messageMentionsBot(data, eventType),
      botMentionId: botMentionId(data, eventType), raw: data,
    }
  }
  return undefined
}

function extractQuotedText(data: QQDispatchData): string {
  const reference = data.message_reference || data.reference || data.quote
  if (reference && typeof reference === 'object') {
    const text = String(reference.content || reference.text || '').trim()
    if (text) return decodeQQText(text)
  }

  // QQ's native reply payload uses message_scene.ext/ref_msg_idx and keeps the
  // referenced message in msg_elements instead of message_reference.
  const elements = data.msg_elements || []
  if (elements.length === 0) return ''
  const ext = Array.isArray(data.message_scene?.ext) ? data.message_scene.ext : []
  const referenceIndex = messageReferenceIndex(data)
  const ownIndex = sceneValue(ext, 'msg_idx')
  const element = referenceIndex
    ? elements.find(item => String(item.msg_idx || '') === referenceIndex)
    : elements.find(item => String(item.msg_idx || '') !== ownIndex)
  if (!element) return ''
  return decodeQQText(String(element.content || element.text || '').trim())
}

function extractQuote(data: QQDispatchData): QQQuoteInput | undefined {
  const text = extractQuotedText(data)
  const reference = data.message_reference || data.reference || data.quote
  let record = reference && typeof reference === 'object' ? reference : undefined
  if (!record && Array.isArray(data.msg_elements)) {
    const ext = Array.isArray(data.message_scene?.ext) ? data.message_scene.ext : []
    const referenceIndex = messageReferenceIndex(data)
    const element = referenceIndex ? data.msg_elements.find(item => String(item.msg_idx || '') === referenceIndex) : undefined
    if (element) record = element
  }
  const messageId = String(record?.id || record?.message_id || record?.messageId || '').trim() || undefined
  const sender = record?.author && typeof record.author === 'object' ? record.author as QQAuthor : undefined
  const senderId = String(sender?.user_openid || sender?.member_openid || sender?.id || record?.sender_id || '').trim() || undefined
  const senderName = String(sender?.username || sender?.nickname || record?.sender_name || '').trim() || undefined
  const attachments = extractAttachments(record as QQDispatchData | undefined, true)
  if (!text && !messageId && !senderId && attachments.length === 0) return undefined
  return { messageId, senderId, senderName, text, attachments }
}

function messageSceneIndex(data: QQDispatchData): string | undefined {
  const ext = Array.isArray(data.message_scene?.ext) ? data.message_scene.ext : []
  return sceneValue(ext, 'msg_idx') || String(data.id || '').trim() || undefined
}

function messageReferenceIndex(data: QQDispatchData): string | undefined {
  const ext = Array.isArray(data.message_scene?.ext) ? data.message_scene.ext : []
  return sceneValue(ext, 'ref_msg_idx') || sceneValue(ext, 'msg_ref_idx') || undefined
}

function extractAttachments(data: QQDispatchData | undefined, quoted = false): QQAttachmentInput[] {
  if (!data) return []
  const values: Array<Record<string, unknown>> = []
  if (Array.isArray(data.attachments)) values.push(...data.attachments.filter(isRecord))
  if (Array.isArray(data.msg_elements)) {
    const ext = Array.isArray(data.message_scene?.ext) ? data.message_scene.ext : []
    const referenceIndex = sceneValue(ext, 'ref_msg_idx') || sceneValue(ext, 'msg_ref_idx')
    for (const element of data.msg_elements) {
      if (!quoted && referenceIndex && String(element.msg_idx || '') === referenceIndex) continue
      const type = String(element.type || element.element_type || element.kind || '').toLowerCase()
      if (type && !/(image|photo|picture|file|video|audio|voice|record|media|attachment)/u.test(type)) continue
      if (isRecord(element.attachment)) values.push(element.attachment)
      else values.push(element)
    }
  }
  const output: QQAttachmentInput[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const sourceUrl = firstString(value, ['url', 'file_url', 'download_url', 'downloadUrl', 'href', 'file'])
    const platformFileId = firstString(value, ['file_id', 'fileid', 'fileId', 'id'])
    if (!sourceUrl && !platformFileId && !isRecord(value.attachment)) continue
    const filename = firstString(value, ['filename', 'file_name', 'name']) || inferFilename(sourceUrl) || 'QQ附件'
    const contentType = firstString(value, ['content_type', 'contentType', 'mime', 'mime_type', 'type'])
    const kind = mediaKind(contentType, filename, String(value.type || value.element_type || value.kind || ''))
    const key = `${platformFileId || ''}|${sourceUrl || ''}|${filename}|${kind}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      sourceUrl, filename, contentType, platformFileId,
      size: numberValue(value, ['size', 'file_size', 'bytes']),
      width: numberValue(value, ['width', 'img_width']),
      height: numberValue(value, ['height', 'img_height']),
      durationMs: numberValue(value, ['duration_ms', 'duration']), quoted, kind,
    })
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  return undefined
}

function numberValue(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const item = Number(value[key])
    if (Number.isFinite(item) && item >= 0) return item
  }
  return undefined
}

function inferFilename(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    return name && name !== '/' ? name : undefined
  } catch { return undefined }
}

function mediaKind(contentType: string | undefined, filename: string, rawType: string): QQMediaKind {
  const value = `${contentType || ''} ${filename} ${rawType}`.toLowerCase()
  if (/voice|record|audio|\.(amr|silk|mp3|wav|ogg|m4a)(?:$|\?)/u.test(value)) return 'voice'
  if (/video|\.(mp4|mov|avi|mkv|webm)(?:$|\?)/u.test(value)) return 'video'
  if (/image|photo|picture|\.(png|jpe?g|gif|webp|bmp|heic)(?:$|\?)/u.test(value)) return 'image'
  if (/audio/u.test(value)) return 'audio'
  return 'file'
}

function sceneValue(ext: unknown[], key: string): string {
  const prefix = `${key}=`
  for (const item of ext) {
    if (typeof item === 'string' && item.startsWith(prefix)) return item.slice(prefix.length).trim()
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.key === key) return String(record.value || '').trim()
    if (key in record) return String(record[key] || '').trim()
  }
  return ''
}

function decodeQQText(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}
