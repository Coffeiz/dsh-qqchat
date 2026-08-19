import type { QQChatDatabase } from './db.js'
import type {
  AccountRow,
  QQAccessTokenPayload,
  QQChatConfig,
  QQGatewayPayload,
  QQSendOptions,
  ReplyFormat,
} from './types.js'

const API_BASE = 'https://api.sgroup.qq.com'
const SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com'
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|\*\*|__|`|\[[^\]]+\]\([^\)]+\)/m.test(text)
}

interface CachedToken {
  token: string
  expiresAt: number
}

interface QQSendBody {
  msg_type: number
  msg_seq: number
  msg_id?: string
  content?: string
  markdown?: { content: string }
}

export class QQApiClient {
  private readonly tokens = new Map<number, CachedToken>()
  private readonly sequences = new Map<string, number>()

  constructor(
    private readonly db: QQChatDatabase,
    readonly config: QQChatConfig,
  ) {}

  clearToken(accountId: number): void { this.tokens.delete(Number(accountId)) }

  async token(account: AccountRow): Promise<string> {
    const id = Number(account.id)
    const cached = this.tokens.get(id)
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
    const response = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: account.app_id, clientSecret: account.app_secret }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await safeJson<QQAccessTokenPayload>(response)
    if (!response.ok || !data?.access_token) throw new Error(`QQ access_token 获取失败: HTTP ${response.status}`)
    const ttl = Number(data.expires_in || 7200)
    this.tokens.set(id, { token: data.access_token, expiresAt: Date.now() + Math.max(60, ttl) * 1000 })
    return data.access_token
  }

  async gatewayUrl(account: AccountRow): Promise<string> {
    const token = await this.token(account)
    const base = account.sandbox ? SANDBOX_API_BASE : API_BASE
    const response = await fetch(`${base}/gateway`, {
      headers: { Authorization: `QQBot ${token}` }, signal: AbortSignal.timeout(15_000),
    })
    const data = await safeJson<QQGatewayPayload>(response)
    if (!response.ok || !data?.url) throw new Error(`QQ gateway 获取失败: HTTP ${response.status}`)
    return data.url
  }

  private nextSeq(messageId: string | null | undefined): number {
    const key = messageId || `active:${Date.now()}:${Math.random()}`
    const next = (this.sequences.get(key) || 0) + 1
    this.sequences.set(key, next)
    return next
  }

  private async request<T = Record<string, unknown>>(
    account: AccountRow,
    method: string,
    path: string,
    body: unknown,
    retry = true,
  ): Promise<T> {
    const token = await this.token(account)
    const base = account.sandbox ? SANDBOX_API_BASE : API_BASE
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `QQBot ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await safeJson<Record<string, unknown>>(response)
    if (response.status === 401 && retry) {
      this.clearToken(account.id)
      return this.request<T>(account, method, path, body, false)
    }
    if (!response.ok) {
      const code = data?.code ? ` code=${String(data.code)}` : ''
      const message = data?.message ? ` ${String(data.message)}` : ''
      throw new Error(`QQ API HTTP ${response.status}${code}${message}`)
    }
    return (data || {}) as T
  }

  async sendText(
    account: AccountRow,
    targetId: string,
    text: string,
    { group = false, messageId = null, format = this.config.replyFormat }: QQSendOptions = {},
  ): Promise<Record<string, unknown>> {
    const path = group ? `/v2/groups/${encodeURIComponent(targetId)}/messages` : `/v2/users/${encodeURIComponent(targetId)}/messages`
    const seq = this.nextSeq(messageId)
    const useMarkdown = format === 'markdown' || (format === 'smart' && looksLikeMarkdown(text))
    const makeBody = (markdown: boolean): QQSendBody => ({
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

  async sendReplyWithActiveFallback(
    account: AccountRow,
    targetId: string,
    text: string,
    options: QQSendOptions,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.sendText(account, targetId, text, options)
    } catch (error) {
      if (!options.messageId) throw error
      return this.sendText(account, targetId, text, { ...options, messageId: null })
    }
  }
}

async function safeJson<T>(response: Response): Promise<T | undefined> {
  try { return await response.json() as T } catch { return undefined }
}

export function isReplyFormat(value: string): value is ReplyFormat {
  return value === 'smart' || value === 'markdown' || value === 'compat'
}
