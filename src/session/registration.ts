import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const QQCHAT_SESSION_EVENT_TYPE = 'qqchat/message'

interface KnownEventTypesModule {
  KNOWN_SESSION_EVENT_TYPES?: { add(type: string): unknown }
}

export interface SessionEventRegistrationOptions {
  readonly argv?: readonly string[]
  readonly dshHome?: string
  readonly anchors?: readonly string[]
}

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
 * Register the plugin's log-only event in every reachable dsh-session copy.
 *
 * DSH does not expose a public downstream event registration API yet. This
 * small compatibility shim follows the ecosystem convention used by other
 * DSH plugins and is intentionally idempotent and best-effort.
 */
export async function registerQQChatSessionEventType(options: SessionEventRegistrationOptions = {}): Promise<number> {
  const argv = options.argv || process.argv
  const profileName = profileNameFromArgv(argv)
  const dshHome = options.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh')
  const profileAnchors = profileName
    ? [
        join(dshHome, 'profiles', profileName, 'package.json'),
        join(dshHome, 'profiles', 'package.json'),
      ]
    : []
  const anchors = [...(options.anchors || [import.meta.url, argv[1]]), ...profileAnchors].filter(
    (anchor): anchor is string => typeof anchor === 'string' && anchor.length > 0,
  )
  const registeredPaths = new Set<string>()
  let registered = 0

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor)
      registered += await registerSessionCopy(require, registeredPaths)
      // Persistence may resolve its own peer dependency from a different
      // package tree. Register the copy selected by that validator too.
      try {
        const persistence = require.resolve('@deepseek-ai/dsh-session-persistence')
        registered += await registerSessionCopy(createRequire(persistence), registeredPaths)
      } catch {
        // Some minimal profiles do not ship the persistence package.
      }
    } catch {
      // A profile may not expose this package from one of the anchors. The
      // other anchor can still reach the validator used by the running host.
    }
  }

  return registered
}

async function registerSessionCopy(require: NodeRequire, registeredPaths: Set<string>): Promise<number> {
  const resolved = require.resolve('@deepseek-ai/dsh-session')
  const candidates = [resolved]
  // The DSH development CLI can resolve workspace source through tsx while
  // the published package resolves lib/. Register both when source exists.
  const packageRoot = dirname(dirname(resolved))
  candidates.push(join(packageRoot, 'src', 'index.ts'))
  candidates.push(join(packageRoot, 'src', 'index.js'))
  let registered = 0
  for (const candidate of candidates) {
    let physical: string
    try { physical = realpathSync(candidate) } catch { continue }
    if (registeredPaths.has(physical)) continue
    registeredPaths.add(physical)
    try {
      // DSH publishes ESM builds. Dynamic import also handles a CJS build and
      // preserves the actual module instance selected by the host anchor.
      const module = await import(pathToFileURL(physical).href) as KnownEventTypesModule
      if (module.KNOWN_SESSION_EVENT_TYPES?.add) {
        module.KNOWN_SESSION_EVENT_TYPES.add(QQCHAT_SESSION_EVENT_TYPE)
        registered += 1
      }
    } catch {
      // A published package may not ship its source entry; the lib entry above
      // remains the normal registration target.
    }
  }
  return registered
}
