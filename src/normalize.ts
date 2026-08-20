import type { QQAuthor, QQDispatchData, QQNormalizedMessage } from './types.js'

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
      messageId: String(data.id || ''), text: String(data.content || '').trim(),
      quotedText: extractQuotedText(data), mentioned: true,
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
      messageId: String(data.id || ''), text: String(data.content || '').trim(),
      quotedText: extractQuotedText(data), mentioned: messageMentionsBot(data, eventType),
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
  const referenceIndex = sceneValue(ext, 'ref_msg_idx') || sceneValue(ext, 'msg_ref_idx')
  const ownIndex = sceneValue(ext, 'msg_idx')
  const element = referenceIndex
    ? elements.find(item => String(item.msg_idx || '') === referenceIndex)
    : elements.find(item => String(item.msg_idx || '') !== ownIndex)
  if (!element) return ''
  return decodeQQText(String(element.content || element.text || '').trim())
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
