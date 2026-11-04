import { SessionId } from '@deepseek-ai/dsh-session';
interface SessionLocation {
    readonly kind?: string;
    readonly path?: string;
}
interface StoredSessionSummary {
    readonly header: {
        readonly id: string;
    };
    readonly location?: SessionLocation;
}
interface SessionWriteHandle {
    close(): Promise<void>;
}
export interface QQChatPersistence {
    list(): Promise<readonly StoredSessionSummary[]>;
    open(id: SessionId, access: 'write'): Promise<SessionWriteHandle>;
    stat(id: SessionId): Promise<StoredSessionSummary | undefined>;
}
export interface MigrationLogger {
    info?(message: string): void;
    warn?(message: string): void;
}
export interface QQChatMigrationResult {
    readonly sessions: number;
    readonly migratedEvents: number;
    readonly failedSessions: number;
    readonly deferredSessions: number;
}
/** Convert old QQ display events before DSH Web or resume reads their Sessions. */
export declare function migrateQQChatSessions(persistence: QQChatPersistence, logger: MigrationLogger): Promise<QQChatMigrationResult>;
export {};
