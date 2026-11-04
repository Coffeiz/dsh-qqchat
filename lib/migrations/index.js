import { migrateQQChatSessions } from './qqchat-display-events.js';
/** Add future data upgrades here; each step must be independently idempotent. */
const migrations = [
    { id: 'qqchat-display-events-v4', run: migrateQQChatSessions },
];
/** Run startup data migrations in order, keeping one failed step from blocking later steps or plugin startup. */
export async function runMigrations(persistence, logger) {
    const total = { sessions: 0, migratedEvents: 0, failedSessions: 0, deferredSessions: 0 };
    for (const migration of migrations) {
        try {
            const result = await migration.run(persistence, logger);
            total.sessions += result.sessions;
            total.migratedEvents += result.migratedEvents;
            total.failedSessions += result.failedSessions;
            total.deferredSessions += result.deferredSessions;
        }
        catch (error) {
            total.failedSessions += 1;
            logger.warn?.(`[dsh-qqchat] 迁移 ${migration.id} 执行失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
    }
    return total;
}
