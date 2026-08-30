import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GroupReceiveMode, QQChatConfig, QQChatConfigInput, QQChatRuntimeSettings, ReplyFormat } from './types.js'

const DEFAULT_CONFIG = Object.freeze({
  source: 'dsh-qqchat',
  sandbox: false,
  groupChatEnabled: true,
  groupRequiresAt: true,
  groupReadEnabled: true,
  replyFormat: 'smart' as ReplyFormat,
  recentGroupMessages: 40,
  reflectionIdleMs: 120_000,
  reflectionBatchSize: 20,
  reflectionMaxMessages: 80,
  memoryMaxTokens: 1400,
  memoryCompressionMaxTokens: 15000,
})

export function resolveConfig(input: QQChatConfigInput = {}): QQChatConfig {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const replyFormat: ReplyFormat = ['smart', 'markdown', 'compat'].includes(input.replyFormat ?? '')
    ? input.replyFormat as ReplyFormat
    : DEFAULT_CONFIG.replyFormat

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
  })
}

export function defaultRuntimeSettings(config: QQChatConfig): QQChatRuntimeSettings {
  const groupReceiveMode: GroupReceiveMode = !config.groupChatEnabled
    ? 'silent'
    : config.groupRequiresAt ? 'mention' : 'auto'
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
  }
}

function positiveInt(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function positiveIntOrUndefined(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined
}
