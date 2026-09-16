import type { Context } from '@deepseek-ai/cordis';
import type { QQChatDatabase } from './db.js';
import type { GroupRow, LoggerLike, MemoryDocuments, MemoryView, QQChatConfig, ReflectionPayload, MemberBatchReflectionPayload, QQNormalizedMessage } from '../types.js';
interface MemberReflectionPayload {
    profile_add?: unknown;
    profile_remove?: unknown;
    pattern_add?: unknown;
    pattern_remove?: unknown;
    profile?: unknown;
    pattern?: unknown;
    summary?: unknown;
    memory?: unknown;
    daily?: unknown;
}
/** 与咕咕一致：每个记忆 scope 的本轮直注入预算（按字符计）。 */
export declare const MEMORY_INJECT_CHARS = 2000;
export declare class MemoryEngine {
    private readonly ctx;
    private readonly db;
    private readonly config;
    private readonly logger;
    private readonly timers;
    private readonly memberTimers;
    private readonly memberBatchTimers;
    private readonly routes;
    private readonly memberRoutes;
    private readonly reflectingGroups;
    private readonly reflectingMembers;
    private readonly reflectingMemberBatches;
    private readonly groupRetryAt;
    private readonly memberRetryAt;
    private readonly memberBatchRetryAt;
    constructor(ctx: Context, db: QQChatDatabase, config: QQChatConfig, logger?: LoggerLike);
    dispose(): void;
    setRoute(groupId: number, provider: string, model: string, sessionId: string): void;
    setMemberRoute(memberId: number, provider: string, model: string, sessionId: string): void;
    schedule(groupId: number): void;
    scheduleMember(memberId: number): void;
    scheduleGroupMembers(groupId: number): void;
    private inRetryCooldown;
    private reflectionDelay;
    private runScheduledGroupReflection;
    private runScheduledMemberReflection;
    private runScheduledMemberBatchReflection;
    reflectNow(groupId: number): Promise<MemoryView>;
    private reflectNowInternal;
    reflectMembersNow(groupId: number): Promise<MemoryView>;
    private reflectMembersNowInternal;
    reflectMemberNow(memberId: number): Promise<MemoryDocuments>;
    private reflectMemberNowInternal;
    private compactDaily;
    private generateReflection;
    private unreflectedDirectMessages;
    private applyGroupReflection;
    private applyMemberBatchReflection;
    contextForGroup(group: GroupRow, currentMember?: {
        id: number;
        platform_user_id: string;
        display_name: string | null;
    }): string;
    contextForMember(member: {
        id: number;
        platform_user_id: string;
        display_name: string | null;
    }): string;
    currentMessageText(message: QQNormalizedMessage): string;
    memoryView(groupId: number): MemoryView | undefined;
}
export declare function memorySystemPrompt(): string;
export declare function memberBatchMemorySystemPrompt(): string;
export declare function privateMemorySystemPrompt(): string;
export declare function groupCompressionSystemPrompt(): string;
export declare function memberCompressionSystemPrompt(): string;
export declare function parseJsonObject(text: string): ReflectionPayload | MemberReflectionPayload;
export declare function validateMemberBatchPayload(value: unknown, allowedSenderIds: ReadonlySet<string>): value is MemberBatchReflectionPayload;
export {};
