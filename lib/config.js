import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const DEFAULT_CONFIG = Object.freeze({
    source: 'dsh-qqchat',
    sandbox: false,
    groupChatEnabled: true,
    groupRequiresAt: true,
    groupReadEnabled: true,
    replyFormat: 'smart',
    recentGroupMessages: 40,
    reflectionIdleMs: 900_000,
    reflectionBatchSize: 20,
    reflectionMaxMessages: 80,
    memoryMaxTokens: 4096,
    memoryCompressionMaxTokens: 15000,
});
export function resolveConfig(input = {}) {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const replyFormat = ['smart', 'markdown', 'compat'].includes(input.replyFormat ?? '')
        ? input.replyFormat
        : DEFAULT_CONFIG.replyFormat;
    return Object.freeze({
        dataDir: resolve(input.dataDir || join(home, 'plugins', 'dsh-qqchat')),
        source: input.source || DEFAULT_CONFIG.source,
        sandbox: input.sandbox === true,
        agentPreset: input.agentPreset,
        provider: input.provider,
        model: input.model,
        maxTokens: positiveIntOrUndefined(input.maxTokens),
        groupChatEnabled: input.groupChatEnabled !== false,
        groupRequiresAt: input.groupRequiresAt !== false,
        groupReadEnabled: input.groupReadEnabled !== false,
        replyFormat,
        recentGroupMessages: positiveInt(input.recentGroupMessages, DEFAULT_CONFIG.recentGroupMessages),
        reflectionIdleMs: positiveInt(input.reflectionIdleMs, DEFAULT_CONFIG.reflectionIdleMs),
        reflectionBatchSize: positiveInt(input.reflectionBatchSize, DEFAULT_CONFIG.reflectionBatchSize),
        reflectionMaxMessages: positiveInt(input.reflectionMaxMessages, DEFAULT_CONFIG.reflectionMaxMessages),
        memoryMaxTokens: positiveInt(input.memoryMaxTokens, DEFAULT_CONFIG.memoryMaxTokens),
        memoryCompressionMaxTokens: positiveInt(input.memoryCompressionMaxTokens, DEFAULT_CONFIG.memoryCompressionMaxTokens),
    });
}
export function defaultRuntimeSettings(config) {
    const groupReceiveMode = !config.groupChatEnabled
        ? 'silent'
        : config.groupRequiresAt ? 'mention' : 'auto';
    return {
        memoryEnabled: true,
        memoryMemberBatchEnabled: true,
        groupReceiveMode,
        groupReplyFormat: 'compat',
        directReplyFormat: config.replyFormat,
        directStreamingEnabled: config.replyFormat !== 'compat',
        groupMembersCanUseTools: false,
        groupMembersCanReceiveMedia: true,
        groupMembersCanReadMedia: false,
        ownerUserId: '',
    };
}
function positiveInt(value, fallback) {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
function positiveIntOrUndefined(value) {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}
