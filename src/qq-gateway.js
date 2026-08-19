import { normalizeQQDispatch } from './normalize.js'

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 }
const INTENTS = 1 << 25
const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 30_000, 60_000]

export class QQGateway {
  constructor(account, db, api, onMessage, logger = console) {
    this.account = account
    this.db = db
    this.api = api
    this.onMessage = onMessage
    this.logger = logger
    this.stopped = false
    this.ws = undefined
    this.sessionId = undefined
    this.lastSeq = null
    this.heartbeatTimer = undefined
    this.ackTimer = undefined
    this.lastAckAt = 0
    this.loopPromise = undefined
  }

  start() {
    if (this.loopPromise) return
    this.stopped = false
    this.loopPromise = this.loop().finally(() => { this.loopPromise = undefined })
  }

  async stop() {
    this.stopped = true
    this.clearHeartbeat()
    try { this.ws?.close() } catch {}
    try { await this.loopPromise } catch {}
    this.db.setAccountGateway(this.account.id, 'offline', null)
  }

  async loop() {
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
        const delay = RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)]
        await sleep(delay)
      }
    }
  }

  async connectOnce() {
    const [url, token] = await Promise.all([this.api.gatewayUrl(this.account), this.api.token(this.account)])
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      let settled = false
      const finish = error => {
        if (settled) return
        settled = true
        this.clearHeartbeat()
        this.ws = undefined
        if (error) reject(error); else resolve()
      }
      ws.addEventListener('error', () => finish(new Error('QQ WebSocket 连接错误')))
      ws.addEventListener('close', event => {
        if (this.stopped) finish(); else finish(new Error(`QQ WebSocket 已断开 (${event.code})`))
      })
      ws.addEventListener('message', event => {
        this.handleFrame(ws, token, event.data).catch(error => {
          try { ws.close() } catch {}
          finish(error)
        })
      })
    })
  }

  async handleFrame(ws, token, raw) {
    const text = await asText(raw)
    const frame = JSON.parse(text)
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
        await this.handleDispatch(frame.t, frame.d || {})
        break
    }
  }

  async handleDispatch(type, data) {
    if (type === 'READY') {
      this.sessionId = data.session_id || this.sessionId
      const botUserId = String(data.user?.id || data.user?.openid || '') || undefined
      this.db.setAccountGateway(this.account.id, 'online', null, botUserId)
      return
    }
    if (type === 'RESUMED') {
      this.db.setAccountGateway(this.account.id, 'online', null)
      return
    }
    const message = normalizeQQDispatch(type, data, Number(this.account.id))
    if (message) await this.onMessage(message)
  }

  installHeartbeat(ws, interval) {
    this.clearHeartbeat()
    this.lastAckAt = Date.now()
    const tick = () => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastAckAt > interval * 2.5) {
        ws.close(4002, 'heartbeat timeout')
        return
      }
      this.send(ws, OP.HEARTBEAT, this.lastSeq)
    }
    this.heartbeatTimer = setInterval(tick, interval)
    setTimeout(tick, Math.min(1000, interval)).unref?.()
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.heartbeatTimer = undefined
    this.ackTimer = undefined
  }

  send(ws, op, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d: data }))
  }
}

async function asText(data) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  if (data?.text) return data.text()
  return String(data)
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
