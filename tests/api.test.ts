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

test('private text streams use fresh msg_seq values across replies', async () => {
  const requests: Array<{ body: Record<string, unknown> }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push({ body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
    return response({ stream_msg_id: `stream-${requests.length}` })
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
    const first = api.createPrivateTextStream(account, 'user-1', { messageId: 'incoming-1', format: 'compat' })
    const second = api.createPrivateTextStream(account, 'user-1', { messageId: 'incoming-2', format: 'compat' })
    await first.finish('第一条')
    await second.finish('第二条')
    assert.notEqual(requests[0]?.body.msg_seq, requests[2]?.body.msg_seq)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('queued private stream updates receive the stream id from the first response', async () => {
  const requests: Array<{ body: Record<string, unknown> }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push({ body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
    return response(requests.length === 1 ? { id: 'stream-queued' } : {})
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    const stream = api.createPrivateTextStream(
      { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never,
      'user-1',
      { messageId: 'incoming-queued', format: 'compat' },
    )
    stream.push('a'.repeat(120))
    stream.push('b'.repeat(120))
    await stream.finish('a'.repeat(120) + 'b'.repeat(120))
    assert.ok(requests.length >= 2)
    assert.equal(requests[0]?.body.stream_msg_id, undefined)
    assert.equal(requests[1]?.body.stream_msg_id, 'stream-queued')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('gateway URL refreshes a cached token after HTTP 401', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; authorization?: string }> = []
  let tokenCalls = 0
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    const authorization = new Headers(init?.headers).get('authorization') || undefined
    requests.push({ url, authorization })
    if (url.includes('/app/getAppAccessToken')) {
      tokenCalls += 1
      return response({ access_token: `token-${tokenCalls}`, expires_in: 7200 })
    }
    if (requests.filter(request => request.url.endsWith('/gateway')).length === 1) return response({}, 401)
    return response({ url: 'wss://gateway.example' })
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    const url = await api.gatewayUrl({ id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never)
    assert.equal(url, 'wss://gateway.example')
    assert.equal(tokenCalls, 2)
    assert.deepEqual(requests.filter(request => request.url.endsWith('/gateway')).map(request => request.authorization), ['QQBot token-1', 'QQBot token-2'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

function response(body: Record<string, unknown>, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
