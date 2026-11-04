import type { MigrationLogger, QQChatPersistence, QQChatMigrationResult } from './qqchat-display-events.js';
/** Run startup data migrations in order, keeping one failed step from blocking later steps or plugin startup. */
export declare function runMigrations(persistence: QQChatPersistence, logger: MigrationLogger): Promise<QQChatMigrationResult>;
