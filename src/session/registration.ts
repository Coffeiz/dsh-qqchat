import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Session } from '@deepseek-ai/dsh-session'
import type { QQChatDisplayEvent } from '../types.js'

const QQCHAT_DISPLAY_RECORD = 'plugin:qqchat/message'

interface PluginRecordModule {
  appendPluginRecord?: (session: Session, type: typeof QQCHAT_DISPLAY_RECORD, data: QQChatDisplayEvent) => unknown
}

export interface SessionEventRegistrationOptions {
  readonly argv?: readonly string[]
  readonly dshHome?: string
  readonly anchors?: readonly string[]
}

type PluginRecordWriter = NonNullable<PluginRecordModule['appendPluginRecord']>
const pluginRecordWriters: PluginRecordWriter[] = []

export function profileNameFromArgv(argv: readonly string[]): string | undefined {
  const profileIndex = argv.indexOf('--profile')
  if (profileIndex >= 0) {
    const value = argv[profileIndex + 1]
    if (value && !value.startsWith('-')) return value
  }
  const inline = argv.find(value => value.startsWith('--profile='))
  const value = inline?.slice('--profile='.length)
  return value && !value.startsWith('-') ? value : undefined
}

/**
 * Resolve the Session package copies the host and persistence provider may use.
 * The writer is tried against the live Session; private-class identity makes
 * writers from unrelated copies reject before they can append anything.
 */
export async function loadQQChatPluginRecordWriters(options: SessionEventRegistrationOptions = {}): Promise<number> {
  const argv = options.argv || process.argv
  const profileName = profileNameFromArgv(argv)
  const dshHome = options.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh')
  const profileAnchors = profileName
    ? [join(dshHome, 'profiles', profileName, 'package.json'), join(dshHome, 'profiles', 'package.json')]
    : []
  const anchors = [...(options.anchors || [import.meta.url, argv[1]]), ...profileAnchors]
    .filter((anchor): anchor is string => typeof anchor === 'string' && anchor.length > 0)
  const loadedPaths = new Set<string>()

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor)
      await loadSessionCopy(require, loadedPaths)
      try {
        const persistence = require.resolve('@deepseek-ai/dsh-session-persistence')
        await loadSessionCopy(createRequire(persistence), loadedPaths)
      } catch {
        // Small profiles may not expose a separately installed persistence package.
      }
    } catch {
      // Another anchor may still resolve the copy used by the host.
    }
  }
  return pluginRecordWriters.length
}

export function appendQQChatPluginRecord(session: Session, event: QQChatDisplayEvent): boolean {
  for (const writer of pluginRecordWriters) {
    try {
      writer(session, QQCHAT_DISPLAY_RECORD, event)
      return true
    } catch {
      // A writer from another package copy fails its Session private-brand check before mutation.
    }
  }
  return false
}

async function loadSessionCopy(require: NodeRequire, loadedPaths: Set<string>): Promise<void> {
  const resolved = require.resolve('@deepseek-ai/dsh-session')
  const packageRoot = dirname(dirname(resolved))
  const candidates = [resolved, join(packageRoot, 'src', 'index.ts'), join(packageRoot, 'src', 'index.js')]
  for (const candidate of candidates) {
    let physical: string
    try { physical = realpathSync(candidate) } catch { continue }
    if (loadedPaths.has(physical)) continue
    loadedPaths.add(physical)
    try {
      const module = await import(pathToFileURL(physical).href) as PluginRecordModule
      if (module.appendPluginRecord) pluginRecordWriters.push(module.appendPluginRecord)
    } catch {
      // A packaged build may not contain source; its resolved lib entry remains the normal target.
    }
  }
}
