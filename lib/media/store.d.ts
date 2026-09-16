import type { Context } from '@deepseek-ai/cordis';
import type { LoggerLike, QQAttachmentInput, StoredAttachmentSummary } from '../types.js';
import type { QQChatDatabase } from '../storage/db.js';
export declare class QQMediaStore {
    private readonly db;
    private readonly ctx?;
    private readonly logger;
    readonly root: string;
    constructor(db: QQChatDatabase, ctx?: Context | undefined, logger?: LoggerLike);
    ingest(accountId: number, messageId: string, attachments: QQAttachmentInput[]): Promise<StoredAttachmentSummary[]>;
    cleanup(): Promise<void>;
    private download;
    private saveImageRef;
}
