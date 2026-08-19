function authorId(author = {}) {
  return String(author.user_openid || author.member_openid || author.id || '')
}

function authorName(author = {}) {
  return String(author.username || author.nickname || '').trim()
}

export function messageMentionsBot(data, eventType) {
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

export function botMentionId(data, eventType) {
  const mentions = data.mentions
  if (Array.isArray(mentions)) {
    for (const item of mentions) {
      if (!item || typeof item !== 'object' || item.bot !== true) continue
      for (const key of ['id', 'user_openid', 'member_openid', 'openid']) {
        if (item[key]) return String(item[key])
      }
    }
  }
  if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
    const match = String(data.content || '').match(/<@!?([^>]+)>/)
    if (match) return match[1]
  }
  return ''
}

export function normalizeQQDispatch(eventType, data, accountId) {
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

function extractQuotedText(data) {
  const reference = data.message_reference || data.reference || data.quote
  if (!reference || typeof reference !== 'object') return ''
  return String(reference.content || reference.text || '').trim()
}
