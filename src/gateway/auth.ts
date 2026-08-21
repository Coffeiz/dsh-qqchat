import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { decryptQQSecret } from './crypto.js'
import type { QQChatDatabase } from '../storage/db.js'
import type { AccountRow, QQBindCreatePayload, QQBindPollPayload, QQChatConfig } from '../types.js'

const CREATE_URL = 'https://q.qq.com/lite/create_bind_task'
const POLL_URL = 'https://q.qq.com/lite/poll_bind_result'
const FRONTEND = 'https://q.qq.com/qqbot/openclaw/connect.html'
const TASK_TTL_MS = 600_000

export interface QQBindStartResult {
  taskId: string
  scanUrl: string
  qrDataUrl: string
  expiresInMs: number
}

export type QQBindPollResult =
  | { status: 'waiting' }
  | { status: 'expired' }
  | { status: 'fail'; reason: string }
  | { status: 'success'; account: PublicAccount }

export interface PublicAccount {
  id: number
  appId: string
  botUserId: string | null
  enabled: boolean
  sandbox: boolean
  gatewayStatus: string
  gatewayLastError: string | null
}

export class QQBindService {
  constructor(
    private readonly db: QQChatDatabase,
    private readonly config: QQChatConfig,
  ) {}

  async start(): Promise<QQBindStartResult> {
    const aesKey = randomBytes(32).toString('base64')
    const response = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: aesKey }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`QQ 创建连接任务失败: HTTP ${response.status}`)
    const payload = await response.json() as QQBindCreatePayload
    if (payload.retcode !== 0) throw new Error(`QQ 创建连接任务失败: ${payload.msg || 'unknown'}`)
    const taskId = payload.data?.task_id
    if (!taskId) throw new Error('QQ 未返回 task_id')
    this.db.saveAuthTask(String(taskId), aesKey, TASK_TTL_MS)
    const scanUrl = `${FRONTEND}?task_id=${encodeURIComponent(taskId)}&_wv=2&source=${encodeURIComponent(this.config.source)}`
    const qrDataUrl = await QRCode.toDataURL(scanUrl, { width: 224, margin: 1, errorCorrectionLevel: 'M' })
    return { taskId: String(taskId), scanUrl, qrDataUrl, expiresInMs: TASK_TTL_MS }
  }

  async poll(taskId: string): Promise<QQBindPollResult> {
    const task = this.db.getAuthTask(taskId)
    if (!task) return { status: 'expired' }
    const response = await fetch(POLL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: taskId }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`QQ 轮询授权失败: HTTP ${response.status}`)
    const payload = await response.json() as QQBindPollPayload
    if (payload.retcode !== 0) return { status: 'fail', reason: payload.msg || 'unknown' }
    const data = payload.data || {}
    if (data.status === 3) {
      this.db.deleteAuthTask(taskId)
      return { status: 'expired' }
    }
    if (data.status !== 2) return { status: 'waiting' }
    const appId = String(data.bot_appid || '')
    const encrypted = String(data.bot_encrypt_secret || '')
    if (!appId || !encrypted) return { status: 'fail', reason: 'QQ 返回缺少 AppID 或 Secret' }
    let secret: string
    try {
      secret = decryptQQSecret(encrypted, task.aes_key)
    } catch {
      return { status: 'fail', reason: 'QQ Secret 解密失败' }
    }
    const account = this.db.upsertAccount(appId, secret, this.config.sandbox)
    this.db.deleteAuthTask(taskId)
    return { status: 'success', account: publicAccount(account) }
  }
}

function publicAccount(account: AccountRow): PublicAccount {
  return {
    id: Number(account.id), appId: account.app_id, botUserId: account.bot_user_id || null,
    enabled: account.enabled === 1, sandbox: account.sandbox === 1,
    gatewayStatus: account.gateway_status, gatewayLastError: account.gateway_last_error || null,
  }
}
