import type { QQDispatchData, QQNormalizedMessage } from '../types.js';
/** Replace QQ's stable mention tokens with the best known display name. */
export declare function renderQQMentionNames(text: string, data: QQDispatchData, lookup?: (platformUserId: string) => string | undefined): string;
export declare function messageMentionsBot(data: QQDispatchData, eventType: string): boolean;
export declare function botMentionId(data: QQDispatchData, eventType: string): string;
export declare function normalizeQQDispatch(eventType: string, data: QQDispatchData | undefined, accountId: number): QQNormalizedMessage | undefined;
