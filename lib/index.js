import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DshQQBridge } from './session/agent-bridge.js';
import { resolveConfig } from './config.js';
import { QQChatDatabase } from './storage/db.js';
import { QQChatLogger } from './shared/logging.js';
import { MemoryEngine } from './storage/memory.js';
import { QQMediaStore } from './media/store.js';
import { QQApiClient } from './gateway/api.js';
import { QQBindService } from './gateway/auth.js';
import { createQQChatRpc } from './transport/rpc.js';
import { QQChatRuntime } from './session/runtime.js';
import { loadQQChatPluginRecordWriters } from './session/registration.js';
import { runMigrations } from './migrations/index.js';
const qqChatPluginRecordWriters = await loadQQChatPluginRecordWriters();
export const name = 'dsh-qqchat';
export const inject = ['connection', 'agents', 'agentDefaultModel', 'commands', 'llm', 'tools', 'webServer', 'workspaceRegistry', 'sessionPersistence'];
export async function apply(ctx, inputConfig = {}) {
    const config = resolveConfig(inputConfig);
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    const baseLogger = ctx.logger || console;
    const logger = new QQChatLogger(baseLogger);
    if (qqChatPluginRecordWriters === 0) {
        logger.warn?.('[dsh-qqchat] 当前 DSH 未导出插件记录 API；被动消息仍保存在 QQ 数据库，不写入不兼容的 Session 事件');
    }
    const persistence = ctx.sessionPersistence;
    if (persistence) {
        await runMigrations(persistence, logger);
    }
    else {
        logger.warn?.('[dsh-qqchat] 当前 DSH 未提供 Session 持久化服务，跳过旧 Session 迁移');
    }
    const db = new QQChatDatabase(join(config.dataDir, 'qqchat.sqlite'));
    const api = new QQApiClient(db, config);
    const auth = new QQBindService(db, config);
    const memory = new MemoryEngine(ctx, db, config, logger);
    const media = new QQMediaStore(db, ctx, logger);
    const bridge = new DshQQBridge(ctx, db, memory, config, logger);
    const runtime = new QQChatRuntime(ctx, db, api, auth, memory, bridge, config, logger, media);
    ctx.connection.rpc.handle('/qqchat', createQQChatRpc(runtime));
    ctx.effect(() => {
        void (async () => {
            await runtime.start();
        })().catch(error => logger.error?.(error));
        return () => runtime.stop();
    }, 'dsh-qqchat runtime');
}
export { QQChatDatabase } from './storage/db.js';
export { normalizeQQDispatch } from './gateway/normalize.js';
export default { name, inject, apply };
