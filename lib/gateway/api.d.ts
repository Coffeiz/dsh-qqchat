import type { QQChatDatabase } from '../storage/db.js';
import type { AccountRow, QQChatConfig, QQSendOptions, ReplyFormat } from '../types.js';
export interface QQPrivateTextStream {
    push(delta: string): void;
    finish(text: string): Promise<void>;
    hasSent(): boolean;
}
export declare class QQApiClient {
    private readonly db;
    readonly config: QQChatConfig;
    private readonly tokens;
    private readonly sequences;
    private streamSequence;
    constructor(db: QQChatDatabase, config: QQChatConfig);
    clearToken(accountId: number): void;
    token(account: AccountRow): Promise<string>;
    gatewayUrl(account: AccountRow, retry?: boolean): Promise<string>;
    private nextSeq;
    /**
     * QQ stream_messages requires a fresh msg_seq for each stream session.
     * It is intentionally not scoped by the inbound message id: using 1 for
     * every reply causes QQ to reject later streams as duplicated messages.
     */
    private nextStreamSeq;
    private request;
    sendText(account: AccountRow, targetId: string, text: string, { group, messageId, format }?: QQSendOptions): Promise<Record<string, unknown>>;
    sendReplyWithActiveFallback(account: AccountRow, targetId: string, text: string, options: QQSendOptions): Promise<Record<string, unknown>>;
    createPrivateTextStream(account: AccountRow, targetId: string, { messageId, format }?: QQSendOptions): QQPrivateTextStream;
}
export declare function isReplyFormat(value: string): value is ReplyFormat;
