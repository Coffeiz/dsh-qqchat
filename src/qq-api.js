const API_BASE = 'https://api.sgroup.qq.com'
const SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com'
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'

function looksLikeMarkdown(text) {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|\*\*|__|`|\[[^\]]+\]\([^\)]+\)/m.test(text)
}

export class QQApiClient {
  constructor(db, config) {
    this.db = db
    this.config = config
    this.tokens = new Map()
    this.sequences = new Map()
  }

  clearToken(accountId) { this.tokens.delete(Number(accountId)) }

  async token(account) {
    const id = Number(account.id)
    const cached = this.tokens.get(id)
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
    const response = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: account.app_id, clientSecret: account.app_secret }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await safeJson(response)
    if (!response.ok || !data?.access_token) throw new Error(`QQ access_token 获取失败: HTTP ${response.status}`)
    const ttl = Number(data.expires_in || 7200)
    this.tokens.set(id, { token: data.access_token, expiresAt: Date.now() + Math.max(60, ttl) * 1000 })
    return data.access_token
  }

  async gatewayUrl(account) {
    const token = await this.token(account)
    const base = account.sandbox ? SANDBOX_API_BASE : API_BASE
    const response = await fetch(`${base}/gateway`, {
      headers: { Authorization: `QQBot ${token}` }, signal: AbortSignal.timeout(15_000),
    })
    const data = await safeJson(response)
    if (!response.ok || !data?.url) throw new Error(`QQ gateway 获取失败: HTTP ${response.status}`)
    return data.url
  }

  nextSeq(messageId) {
    const key = messageId || `active:${Date.now()}:${Math.random()}`
    const next = (this.sequences.get(key) || 0) + 1
    this.sequences.set(key, next)
    return next
  }

  async request(account, method, path, body, retry = true) {
    const token = await this.token(account)
    const base = account.sandbox ? SANDBOX_API_BASE : API_BASE
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `QQBot ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await safeJson(response)
    if (response.status === 401 && retry) {
      this.clearToken(account.id)
      return this.request(account, method, path, body, false)
    }
    if (!response.ok) {
      const code = data?.code ? ` code=${data.code}` : ''
      const message = data?.message ? ` ${data.message}` : ''
      throw new Error(`QQ API HTTP ${response.status}${code}${message}`)
    }
    return data
  }

  async sendText(account, targetId, text, { group = false, messageId = null, format = this.config.replyFormat } = {}) {
    const path = group ? `/v2/groups/${encodeURIComponent(targetId)}/messages` : `/v2/users/${encodeURIComponent(targetId)}/messages`
    const seq = this.nextSeq(messageId)
    const useMarkdown = format === 'markdown' || (format === 'smart' && looksLikeMarkdown(text))
    const makeBody = markdown => ({
      msg_type: markdown ? 2 : 0,
      ...(markdown ? { markdown: { content: text } } : { content: text }),
      msg_seq: seq,
      ...(messageId ? { msg_id: messageId } : {}),
    })
    try {
      return await this.request(account, 'POST', path, makeBody(useMarkdown))
    } catch (error) {
      if (useMarkdown && /50056|markdown|md perm/i.test(String(error))) {
        return this.request(account, 'POST', path, makeBody(false))
      }
      throw error
    }
  }

  async sendReplyWithActiveFallback(account, targetId, text, options) {
    try {
      return await this.sendText(account, targetId, text, options)
    } catch (error) {
      if (!options?.messageId) throw error
      return this.sendText(account, targetId, text, { ...options, messageId: null })
    }
  }
}

async function safeJson(response) {
  try { return await response.json() } catch { return undefined }
}
