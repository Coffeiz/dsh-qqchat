import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import { DshQQBridge } from './agent-bridge.js'
import { resolveConfig } from './config.js'
import { QQChatDatabase } from './db.js'
import { QQChatLogger } from './logging.js'
import { MemoryEngine } from './memory.js'
import { QQApiClient } from './qq-api.js'
import { QQBindService } from './qq-auth.js'
import { createQQChatRpc } from './rpc.js'
import { QQChatRuntime } from './runtime.js'
import type { LoggerLike, QQChatConfigInput } from './types.js'

export const name = 'dsh-qqchat'
export const inject = ['connection', 'agents', 'agentDefaultModel', 'llm', 'tools', 'workspaceRegistry'] as const

export function apply(ctx: Context, inputConfig: QQChatConfigInput = {}): void {
  const config = resolveConfig(inputConfig)
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const db = new QQChatDatabase(join(config.dataDir, 'qqchat.sqlite'))
  const baseLogger = (ctx as unknown as { logger?: LoggerLike }).logger || console
  const logger = new QQChatLogger(baseLogger)
  const api = new QQApiClient(db, config)
  const auth = new QQBindService(db, config)
  const memory = new MemoryEngine(ctx, db, config, logger)
  const bridge = new DshQQBridge(ctx, db, memory, config, logger)
  const runtime = new QQChatRuntime(ctx, db, api, auth, memory, bridge, config, logger)

  ctx.connection.rpc.handle('/qqchat', createQQChatRpc(runtime), { authority: 'loopback' })
  ctx.effect(() => {
    void runtime.start().catch(error => logger.error?.(error))
    return () => runtime.stop()
  }, 'dsh-qqchat runtime')
}

export type { QQChatConfig, QQChatConfigInput } from './types.js'
export { QQChatDatabase } from './db.js'
export { normalizeQQDispatch } from './normalize.js'

export default { name, inject, apply }
