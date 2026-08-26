import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const QQCHAT_SESSION_EVENT_TYPE = 'qqchat/message'

interface KnownEventTypesModule {
  KNOWN_SESSION_EVENT_TYPES?: { add(type: string): unknown }
}

/**
 * Register the plugin's log-only event in every reachable dsh-session copy.
 *
 * DSH does not expose a public downstream event registration API yet. This
 * small compatibility shim follows the ecosystem convention used by other
 * DSH plugins and is intentionally idempotent and best-effort.
 */
export async function registerQQChatSessionEventType(): Promise<number> {
  const profileName = process.argv.find((value, index) => value === '--profile' ? process.argv[index + 1] : undefined)
  const profileAnchors = profileName
    ? [
        join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', profileName, 'package.json'),
        join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'package.json'),
      ]
    : []
  const anchors = [import.meta.url, process.argv[1], ...profileAnchors].filter(
    (anchor): anchor is string => typeof anchor === 'string' && anchor.length > 0,
  )
  const registeredPaths = new Set<string>()
  let registered = 0

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor)
      const resolved = require.resolve('@deepseek-ai/dsh-session')
      const candidates = [resolved]
      // The DSH development CLI can resolve workspace source through tsx while
      // the published package resolves lib/. Register both when source exists.
      const packageRoot = dirname(dirname(resolved))
      candidates.push(join(packageRoot, 'src', 'index.ts'))
      candidates.push(join(packageRoot, 'src', 'index.js'))
      for (const candidate of candidates) {
        if (registeredPaths.has(candidate)) continue
        registeredPaths.add(candidate)
        try {
          // DSH publishes ESM builds. Dynamic import also handles a CJS build
          // and preserves the actual module instance selected by the anchor.
          const module = await import(pathToFileURL(candidate).href) as KnownEventTypesModule
          if (module.KNOWN_SESSION_EVENT_TYPES?.add) {
            module.KNOWN_SESSION_EVENT_TYPES.add(QQCHAT_SESSION_EVENT_TYPE)
            registered += 1
          }
        } catch {
          // A published package may not ship its source entry; the lib entry
          // above remains the normal registration target.
        }
      }
    } catch {
      // A profile may not expose this package from one of the anchors. The
      // other anchor can still reach the validator used by the running host.
    }
  }

  return registered
}
