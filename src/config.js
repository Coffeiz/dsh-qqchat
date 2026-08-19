import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({
  dataDir: undefined,
  source: 'dsh-qqchat',
  sandbox: false,
  agentPreset: undefined,
  provider: undefined,
  model: undefined,
  maxTokens: undefined,
  groupChatEnabled: true,
  groupRequiresAt: true,
  groupReadEnabled: true,
  replyFormat: 'smart',
  recentGroupMessages: 40,
  reflectionIdleMs: 120_000,
  reflectionBatchSize: 20,
  reflectionMaxMessages: 80,
  memoryMaxTokens: 1400,
})

export function resolveConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  config.dataDir = resolve(config.dataDir || join(home, 'plugins', 'dsh-qqchat'))
  config.groupChatEnabled = config.groupChatEnabled !== false
  config.groupRequiresAt = config.groupRequiresAt !== false
  config.groupReadEnabled = config.groupReadEnabled !== false
  config.sandbox = config.sandbox === true
  config.recentGroupMessages = positiveInt(config.recentGroupMessages, 40)
  config.reflectionIdleMs = positiveInt(config.reflectionIdleMs, 120_000)
  config.reflectionBatchSize = positiveInt(config.reflectionBatchSize, 20)
  config.reflectionMaxMessages = positiveInt(config.reflectionMaxMessages, 80)
  config.memoryMaxTokens = positiveInt(config.memoryMaxTokens, 1400)
  if (!['smart', 'markdown', 'compat'].includes(config.replyFormat)) config.replyFormat = 'smart'
  return Object.freeze(config)
}

function positiveInt(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
