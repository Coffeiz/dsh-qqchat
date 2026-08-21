import test from 'node:test'
import assert from 'node:assert/strict'
import { MEMORY_SNAPSHOT_TTL_MS, memorySnapshotHash, restoreMemorySnapshotState, shouldRefreshMemorySnapshot } from '../src/session/memory-snapshot.js'

test('memory snapshot stays stable inside TTL when content is unchanged', () => {
  const text = 'member memory v1'
  const state = { hash: memorySnapshotHash(text), lastInjectedAt: 1_000, stale: false }
  assert.equal(shouldRefreshMemorySnapshot(state, text, 1_000 + MEMORY_SNAPSHOT_TTL_MS - 1), false)
})

test('memory snapshot refreshes after TTL, content changes, or compact', () => {
  const text = 'member memory v1'
  const state = { hash: memorySnapshotHash(text), lastInjectedAt: 1_000, stale: false }
  assert.equal(shouldRefreshMemorySnapshot(state, text, 1_000 + MEMORY_SNAPSHOT_TTL_MS), true)
  assert.equal(shouldRefreshMemorySnapshot(state, 'member memory v2', 1_001), true)
  assert.equal(shouldRefreshMemorySnapshot({ ...state, stale: true }, text, 1_001), true)
})

test('restored snapshot becomes stale when compaction ended after it', () => {
  const state = restoreMemorySnapshotState([
    { type: 'user/message', time: 100, source: { kind: 'plugin', plugin: 'runtime' }, content: [{ type: 'text', text: 'snapshot' }] },
    { type: 'compaction/end', time: 200 },
  ], 'runtime')
  assert.equal(state?.stale, true)
  assert.equal(state?.hash, memorySnapshotHash('snapshot'))
})
