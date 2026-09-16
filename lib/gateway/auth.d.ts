import type { QQChatDatabase } from '../storage/db.js';
import type { QQChatConfig } from '../types.js';
export interface QQBindStartResult {
    taskId: string;
    scanUrl: string;
    qrDataUrl: string;
    expiresInMs: number;
}
export type QQBindPollResult = {
    status: 'waiting';
} | {
    status: 'expired';
} | {
    status: 'fail';
    reason: string;
} | {
    status: 'success';
    account: PublicAccount;
};
export interface PublicAccount {
    id: number;
    appId: string;
    botUserId: string | null;
    enabled: boolean;
    sandbox: boolean;
    gatewayStatus: string;
    gatewayLastError: string | null;
}
export declare class QQBindService {
    private readonly db;
    private readonly config;
    constructor(db: QQChatDatabase, config: QQChatConfig);
    start(): Promise<QQBindStartResult>;
    poll(taskId: string): Promise<QQBindPollResult>;
}
