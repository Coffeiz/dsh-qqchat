import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { QQChatDatabase } from './db.js'
import { resolveConfig } from './config.js'
import { QQBindService } from './qq-auth.js'
import { QQApiClient } from './qq-api.js'
import { MemoryEngine } from './memory.js'
import { DshQQBridge } from './agent-bridge.js'
import { QQChatRuntime } from './runtime.js'
import { createQQChatRpc } from './rpc.js'

export const name = 'dsh-qqchat'
export const inject = ['connection', 'agents', 'llm']

export function apply(ctx, inputConfig = {}) {
  const config = resolveConfig(inputConfig)
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const db = new QQChatDatabase(join(config.dataDir, 'qqchat.sqlite'))
  const logger = ctx.logger || console
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

export default { name, inject, apply }
