import type { Context } from '@deepseek-ai/cordis';
import type { QQChatDatabase } from '../storage/db.js';
export declare function registerQQMediaTools(ctx: Context, db: QQChatDatabase, isAllowed?: (agentId: string, attachmentId: string) => boolean): () => void;
