import test from 'node:test'
import assert from 'node:assert/strict'
import { QQApiClient } from '../src/gateway/api.js'

test('private text stream sends start and finish parts with one stream id', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push({ url, body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
    return response(requests.length === 1 ? { stream_msg_id: 'stream-1' } : {})
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    const stream = api.createPrivateTextStream({ id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never, 'user-1', { messageId: 'incoming-1', format: 'compat' })
    stream.push('你好')
    await stream.finish('你好，世界')
    assert.equal(requests.length, 2)
    assert.deepEqual(requests.map(item => item.body.input_state), [1, 10])
    assert.deepEqual(requests.map(item => item.body.input_mode), ['replace', 'replace'])
    assert.equal(requests[0]?.body.content_raw, '你好，世界')
    assert.equal(requests[1]?.body.content_raw, '你好，世界')
    assert.equal(requests[0]?.body.msg_id, 'incoming-1')
    assert.equal(requests[0]?.body.event_id, 'incoming-1')
    assert.equal(requests[1]?.body.stream_msg_id, 'stream-1')
    assert.equal(stream.hasSent(), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

function response(body: Record<string, unknown>): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}
