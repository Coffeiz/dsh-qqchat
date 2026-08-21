import { normalizeQQDispatch } from './normalize.js'
import type { QQApiClient } from './api.js'
import type { QQChatDatabase } from '../storage/db.js'
import type { AccountRow, LoggerLike, QQDispatchData, QQGatewayFrame, QQNormalizedMessage } from '../types.js'

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

const INTENTS = 1 << 25
const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 30_000, 60_000] as const

type QQMessageHandler = (message: QQNormalizedMessage) => Promise<void> | void

export class QQGateway {
  private stopped = false
  private ws?: WebSocket
  private sessionId?: string
  private lastSeq: number | null = null
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private ackTimer?: ReturnType<typeof setTimeout>
  private lastAckAt = 0
  private loopPromise?: Promise<void>
  private readonly dispatchChains = new Map<string, Promise<void>>()

  constructor(
    readonly account: AccountRow,
    private readonly db: QQChatDatabase,
    private readonly api: QQApiClient,
    private readonly onMessage: QQMessageHandler,
    private readonly logger: LoggerLike = console,
  ) {}

  start(): void {
    if (this.loopPromise) return
    this.stopped = false
    this.loopPromise = this.loop().finally(() => { this.loopPromise = undefined })
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.clearHeartbeat()
    try { this.ws?.close() } catch {}
    try { await this.loopPromise } catch {}
    this.db.setAccountGateway(this.account.id, 'offline', null)
  }

  private async loop(): Promise<void> {
    let attempt = 0
    while (!this.stopped) {
      try {
        this.db.setAccountGateway(this.account.id, 'connecting', null)
        await this.connectOnce()
        attempt = 0
      } catch (error) {
        if (this.stopped) break
        const message = error instanceof Error ? error.message : String(error)
        this.db.setAccountGateway(this.account.id, 'error', message.slice(0, 500))
        this.logger.warn?.(`[dsh-qqchat] QQ gateway: ${message}`)
        const delay = RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)] ?? RECONNECT_DELAYS.at(-1) ?? 60_000
        await sleep(delay)
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const [url, token] = await Promise.all([this.api.gatewayUrl(this.account), this.api.token(this.account)])
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        this.clearHeartbeat()
        this.ws = undefined
        if (error) reject(error)
        else resolve()
      }
      ws.addEventListener('error', () => finish(new Error('QQ WebSocket 连接错误')))
      ws.addEventListener('close', event => {
        if (this.stopped) finish()
        else finish(new Error(`QQ WebSocket 已断开 (${event.code})`))
      })
      ws.addEventListener('message', event => {
        this.handleFrame(ws, token, event.data).catch(error => {
          try { ws.close() } catch {}
          finish(error instanceof Error ? error : new Error(String(error)))
        })
      })
    })
  }

  private async handleFrame(ws: WebSocket, token: string, raw: unknown): Promise<void> {
    const text = await asText(raw)
    const frame = JSON.parse(text) as QQGatewayFrame
    if (typeof frame.s === 'number') this.lastSeq = frame.s
    switch (frame.op) {
      case OP.HELLO: {
        const interval = Number(frame.d?.heartbeat_interval || 45_000)
        this.installHeartbeat(ws, interval)
        if (this.sessionId) {
          this.send(ws, OP.RESUME, { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq })
        } else {
          this.send(ws, OP.IDENTIFY, {
            token: `QQBot ${token}`,
            intents: INTENTS,
            shard: [0, 1],
            properties: { $os: process.platform, $browser: 'dsh-qqchat', $device: 'dsh-qqchat' },
          })
        }
        break
      }
      case OP.HEARTBEAT_ACK:
        this.lastAckAt = Date.now()
        break
      case OP.RECONNECT:
        ws.close(4000, 'server reconnect')
        break
      case OP.INVALID_SESSION:
        this.sessionId = undefined
        this.lastSeq = null
        ws.close(4001, 'invalid session')
        break
      case OP.DISPATCH:
        await this.handleDispatch(frame.t || '', frame.d || {})
        break
    }
  }

  private async handleDispatch(type: string, data: Record<string, unknown>): Promise<void> {
    if (type === 'READY') {
      const sessionId = data.session_id
      this.sessionId = typeof sessionId === 'string' && sessionId ? sessionId : this.sessionId
      const user = isRecord(data.user) ? data.user : undefined
      const botUserId = String(user?.id || user?.openid || '') || undefined
      this.db.setAccountGateway(this.account.id, 'online', null, botUserId)
      return
    }
    if (type === 'RESUMED') {
      this.db.setAccountGateway(this.account.id, 'online', null)
      return
    }
    const message = normalizeQQDispatch(type, data as QQDispatchData, Number(this.account.id))
    if (message) await this.enqueueMessage(message)
  }

  private enqueueMessage(message: QQNormalizedMessage): Promise<void> {
    const key = `${this.account.id}:${message.chatType}:${message.chatId}`
    const previous = this.dispatchChains.get(key) || Promise.resolve()
    const current = previous.catch(() => undefined).then(() => this.onMessage(message))
    this.dispatchChains.set(key, current)
    return current.finally(() => {
      if (this.dispatchChains.get(key) === current) this.dispatchChains.delete(key)
    })
  }

  private installHeartbeat(ws: WebSocket, interval: number): void {
    this.clearHeartbeat()
    this.lastAckAt = Date.now()
    const tick = (): void => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastAckAt > interval * 2.5) {
        ws.close(4002, 'heartbeat timeout')
        return
      }
      this.send(ws, OP.HEARTBEAT, this.lastSeq)
    }
    this.heartbeatTimer = setInterval(tick, interval)
    const firstTick = setTimeout(tick, Math.min(1000, interval))
    firstTick.unref?.()
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.heartbeatTimer = undefined
    this.ackTimer = undefined
  }

  private send(ws: WebSocket, op: number, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d: data }))
  }
}

async function asText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  if (data instanceof Blob) return data.text()
  return String(data)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
