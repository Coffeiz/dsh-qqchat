import assert from 'node:assert/strict'
import test from 'node:test'
import { createQQChatRpc, type QQChatRpcResult } from '../src/transport/rpc.js'
import type { QQChatRuntime } from '../src/session/runtime.js'

test('30 MiB 文件经分片 RPC 完整重组并且只投递一次', async () => {
  const partSize = 128 * 1024
  const size = 30 * 1024 * 1024
  let delivered = 0
  const rpc = createQQChatRpc({
    async sendActiveFile(chatType: string, rowId: number, filename: string, data: Buffer) {
      delivered++
      assert.equal(chatType, 'group')
      assert.equal(rowId, 1)
      assert.equal(filename, 'fixture.dat')
      assert.equal(data.length, size)
      for (let offset = 0; offset < size; offset += partSize) {
        assert.deepEqual(data.subarray(offset, offset + partSize), Buffer.alloc(partSize, offset / partSize))
      }
    },
  } as unknown as QQChatRuntime)
  const call = async (endpoint: string, payload: unknown) => await rpc(endpoint, payload, {} as never) as QQChatRpcResult<{ id: string }>
  const start = await call('chat/upload/start', { chatType: 'group', rowId: 1, filename: 'fixture.dat', size })
  assert.equal(start.ok, true)
  if (!start.ok) return
  const { id } = start.value
  assert.equal((await call('chat/upload/finish', { id })).ok, false)
  assert.equal((await call('chat/upload/part', { id, offset: 1, bytes: [42] })).ok, false)
  for (let offset = 0; offset < size; offset += partSize) {
    const bytes = Array(partSize).fill(offset / partSize)
    assert.equal((await call('chat/upload/part', { id, offset, bytes })).ok, true)
  }
  const results = await Promise.all([call('chat/upload/finish', { id }), call('chat/upload/finish', { id })])
  assert.deepEqual(results.map(result => result.ok), [true, false])
  assert.equal(delivered, 1)
})
