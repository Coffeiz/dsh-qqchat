import { createHash } from 'node:crypto'

export const MEMORY_SNAPSHOT_TTL_MS = 30 * 60 * 1000

export interface MemorySnapshotState {
  hash: string
  lastInjectedAt: number
  stale: boolean
}

export interface MemorySnapshotEvent {
  type?: string
  time?: number
  data?: {
    source?: { kind?: string; plugin?: string; sections?: readonly { name?: string; text?: string }[] }
    content?: readonly { type?: string; text?: string }[]
  }
}

export function memorySnapshotHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function shouldRefreshMemorySnapshot(previous: MemorySnapshotState | undefined, currentText: string, now: number, ttlMs = MEMORY_SNAPSHOT_TTL_MS): boolean {
  if (!previous || previous.stale) return true
  if (previous.hash !== memorySnapshotHash(currentText)) return true
  return now - previous.lastInjectedAt >= ttlMs
}

export function restoreMemorySnapshotState(events: readonly MemorySnapshotEvent[], sourcePlugin: string): MemorySnapshotState | undefined {
  const lastCompactionAt = events.reduce((latest, event) => event.type === 'compaction/end' ? Math.max(latest, Number(event.time) || 0) : latest, 0)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue
    const source = event.data?.source
    if (event.type !== 'user/message' || source?.kind !== 'plugin' || source.plugin !== sourcePlugin) continue
    if (!source.sections?.some(section => section.name === 'qq-chat-context')) continue
    const content = event.data?.content
    const block = content?.length === 1 ? content[0] : undefined
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    return { hash: memorySnapshotHash(block.text), lastInjectedAt: Number(event.time) || 0, stale: lastCompactionAt > (Number(event.time) || 0) }
  }
  return undefined
}
