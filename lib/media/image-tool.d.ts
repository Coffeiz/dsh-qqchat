import type { Context } from '@deepseek-ai/cordis';
import type { QQChatDatabase } from '../storage/db.js';
/** Exposes stored QQ images by attachment ID when a model explicitly requests one. */
export declare function registerQQImageTool(ctx: Context, db: QQChatDatabase, isAllowed?: (agentId: string, attachmentId: string) => boolean): () => void;
