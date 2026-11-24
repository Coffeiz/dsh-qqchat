import type { QQChatDatabase } from '../storage/db.js';
import type { AccountRow, QQChatConfig, QQSendOptions } from '../types.js';
export interface QQPrivateTextStream {
    push(delta: string): void;
    finish(text: string): Promise<void>;
    hasSent(): boolean;
}
export declare class QQApiClient {
    private readonly db;
    readonly config: QQChatConfig;
    private readonly tokens;
    private sequence;
    private readonly passiveReplyCounts;
    constructor(db: QQChatDatabase, config: QQChatConfig);
    clearToken(accountId: number): void;
    token(account: AccountRow, signal?: AbortSignal): Promise<string>;
    gatewayUrl(account: AccountRow, retry?: boolean): Promise<string>;
    private nextSeq;
    private recordPassiveReply;
    private passiveReplyCount;
    private request;
    sendFile(account: AccountRow, targetId: string, filename: string, data: Buffer, { group, messageId }?: QQSendOptions, signal?: AbortSignal): Promise<void>;
    sendVoice(account: AccountRow, targetId: string, data: Buffer, options?: QQSendOptions, signal?: AbortSignal): Promise<void>;
    private sendMedia;
    sendText(account: AccountRow, targetId: string, text: string, { group, messageId, format }?: QQSendOptions): Promise<Record<string, unknown>>;
    sendToolActivity(account: AccountRow, targetId: string, text: string, { group, messageId, format }?: QQSendOptions): Promise<boolean>;
    sendReplyWithActiveFallback(account: AccountRow, targetId: string, text: string, options: QQSendOptions): Promise<Record<string, unknown>>;
    createPrivateTextStream(account: AccountRow, targetId: string, { messageId }?: Pick<QQSendOptions, 'messageId'>): QQPrivateTextStream;
}
export declare class QQMediaDeliveryError extends Error {
}
