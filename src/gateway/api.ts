import type { QQChatDatabase } from '../storage/db.js'
import type {
  AccountRow,
  QQAccessTokenPayload,
  QQChatConfig,
  QQGatewayPayload,
  QQSendOptions,
  ReplyFormat,
} from '../types.js'

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

interface QQStreamBody {
  input_mode: 'replace'
  input_state: 1 | 10
  index: number
  content_type: 'text' | 'markdown'
  content_raw: string
  msg_seq: number
  event_id?: string
  msg_id?: string
  stream_msg_id?: string
}

export interface QQPrivateTextStream {
  push(delta: string): void
  finish(text: string): Promise<void>
  hasSent(): boolean
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

  createPrivateTextStream(
    account: AccountRow,
    targetId: string,
    { messageId = null, format = this.config.replyFormat }: QQSendOptions = {},
  ): QQPrivateTextStream {
    const path = `/v2/users/${encodeURIComponent(targetId)}/stream_messages`
    const msgSeq = this.nextSeq(messageId)
    const contentType = format === 'markdown' ? 'markdown' : 'text'
    let fullText = ''
    let streamMessageId: string | undefined
    let index = 0
    let sent = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let chain = Promise.resolve()
    let finished = false
    let lastSentText = ''

    const enqueue = (inputState: 1 | 10, content: string): Promise<void> => {
      const body: QQStreamBody = {
        input_mode: 'replace', input_state: inputState, index: index++, content_type: contentType,
        content_raw: content, msg_seq: msgSeq,
        ...(messageId ? { msg_id: messageId, event_id: messageId } : {}),
        ...(streamMessageId ? { stream_msg_id: streamMessageId } : {}),
      }
      chain = chain.then(async () => {
        let attempt = 0
        while (true) {
          try {
            const result = await this.request<{ stream_msg_id?: unknown; id?: unknown }>(account, 'POST', path, body)
            sent = true
            if (!streamMessageId) {
              const id = typeof result.stream_msg_id === 'string' ? result.stream_msg_id : result.id
              if (typeof id === 'string' && id) streamMessageId = id
            }
            lastSentText = content
            return
          } catch (error) {
            const message = String(error)
            const rateLimited = /HTTP 429|50002|rate limit/i.test(message)
            if (!rateLimited || attempt >= 3) throw error
            const delay = 1000 * (2 ** attempt++)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      })
      return chain
    }

    const flush = (inputState: 1 | 10 = 1): Promise<void> => {
      timer = undefined
      if (!fullText && inputState !== 10) return chain
      if (inputState !== 10 && fullText === lastSentText) return chain
      return enqueue(inputState, fullText)
    }

    return {
      push: delta => {
        if (!delta || finished) return
        fullText += delta
        if (!timer) {
          timer = setTimeout(() => { void flush().catch(() => {}) }, 500)
          timer.unref?.()
        }
      },
      finish: async text => {
        finished = true
        if (timer) clearTimeout(timer)
        timer = undefined
        fullText = text
        await flush(1)
        await chain
        await flush(10)
        await chain
      },
      hasSent: () => sent,
    }
  }
}

async function safeJson<T>(response: Response): Promise<T | undefined> {
  try { return await response.json() as T } catch { return undefined }
}

export function isReplyFormat(value: string): value is ReplyFormat {
  return value === 'smart' || value === 'markdown' || value === 'compat'
}
