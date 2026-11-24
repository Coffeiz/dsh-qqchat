import test from 'node:test'
import assert from 'node:assert/strict'
import { QQApiClient } from '../src/gateway/api.js'

test('normal sends use only the selected Markdown or plain compatibility format', async () => {
  const requests: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
    return response({})
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'markdown' } as never)
    const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
    await api.sendText(account, 'user-1', '**markdown**', { format: 'markdown' })
    await api.sendText(account, 'user-1', '# plain text', { format: 'compat' })
    assert.deepEqual(requests.map(body => body.msg_type), [2, 0])
    assert.deepEqual(requests.map(body => body.content), [undefined, '# plain text'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('group mentions accept explicit IDs and force Markdown for compat chats', async () => {
  const requests: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
    return response({ id: 'sent' })
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
    await api.sendText(account, 'group-1', '@14C4D3EBED7843EFAC441D659C643BAE <@bot-1> <@!unknown-user> <qqbot-at-user id="raw-user" />', {
      group: true, format: 'compat',
    })
    assert.equal(requests[0]?.msg_type, 2)
    assert.deepEqual(requests[0]?.markdown, {
      content: '<qqbot-at-user id="14C4D3EBED7843EFAC441D659C643BAE" /> <qqbot-at-user id="bot-1" /> <qqbot-at-user id="unknown-user" /> <qqbot-at-user id="raw-user" />',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('plain @IDs in code and URLs remain text while ordinary compat messages stay plain', async () => {
  const requests: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
    return response({ id: 'sent' })
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
    await api.sendText(account, 'group-1', '普通消息 @stranger', { group: true, format: 'compat' })
    const markupExample = '标签示例 <qqbot-at-user id="bad id" />，代码 `<qqbot-at-user id="example-user" />`'
    await api.sendText(account, 'group-1', markupExample, { group: true, format: 'compat' })
    await api.sendText(account, 'group-1', '通知 @14C4D3EBED7843EFAC441D659C643BAE，示例 `@14C4D3EBED7843EFAC441D659C643BAE`，链接 https://example.test/@14C4D3EBED7843EFAC441D659C643BAE', { group: true, format: 'compat' })
    assert.equal(requests[0]?.msg_type, 0)
    assert.equal(requests[0]?.content, '普通消息 @stranger')
    assert.equal(requests[1]?.msg_type, 0)
    assert.equal(requests[1]?.content, markupExample)
    assert.equal(requests[2]?.msg_type, 2)
    assert.deepEqual(requests[2]?.markdown, {
      content: '通知 <qqbot-at-user id="14C4D3EBED7843EFAC441D659C643BAE" />，示例 `@14C4D3EBED7843EFAC441D659C643BAE`，链接 https://example.test/@14C4D3EBED7843EFAC441D659C643BAE',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Markdown permission fallback sends readable original text without QQ tags', async () => {
  const requests: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
    return requests.length === 1
      ? response({ message: 'markdown permission denied' }, 403)
      : response({ id: 'sent' })
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'compat' } as never)
    await api.sendText({ id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never,
      'group-1', '你好 <@member-1>', { group: true, format: 'compat' })
    assert.equal(requests[0]?.msg_type, 2)
    assert.deepEqual(requests[0]?.markdown, { content: '你好 <qqbot-at-user id="member-1" />' })
    assert.equal(requests[1]?.msg_type, 0)
    assert.equal(requests[1]?.content, '你好 <@member-1>')
  } finally {
    globalThis.fetch = originalFetch
  }
})

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
    const api = new QQApiClient({} as never, { replyFormat: 'markdown' } as never)
    const stream = api.createPrivateTextStream({ id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never, 'user-1', { messageId: 'incoming-1' })
    stream.push('你好')
    await stream.finish('你好，世界')
    assert.equal(requests.length, 2)
    assert.deepEqual(requests.map(item => item.body.input_state), [1, 10])
    assert.deepEqual(requests.map(item => item.body.input_mode), ['replace', 'replace'])
    assert.equal(requests[0]?.body.content_raw, '你好，世界')
    assert.equal(requests[0]?.body.content_type, 'markdown')
    assert.equal(requests[1]?.body.content_raw, '你好，世界')
    assert.equal(requests[0]?.body.msg_id, 'incoming-1')
    assert.equal(requests[0]?.body.event_id, 'incoming-1')
    assert.equal(requests[1]?.body.stream_msg_id, 'stream-1')
    assert.equal(stream.hasSent(), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('private text stream closes the confirmed prefix instead of rewriting it at finalization', async () => {
  const requests: Array<{ body: Record<string, unknown> }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/app/getAppAccessToken')) return response({ access_token: 'token', expires_in: 3600 })
    requests.push({ body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
    return response({ stream_msg_id: 'stream-prefix' })
  }) as typeof fetch
  try {
    const api = new QQApiClient({} as never, { replyFormat: 'markdown' } as never)
    const stream = api.createPrivateTextStream({ id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never, 'user-1')
    stream.push('已送达草稿')
    await new Promise(resolve => setTimeout(resolve, 520))
    await assert.rejects(stream.finish('完全不同的最终正文'), /改写了已送达前缀/)
    assert.deepEqual(requests.map(item => item.body.input_state), [1, 10])
    assert.deepEqual(requests.map(item => item.body.content_raw), ['已送达草稿', '已送达草稿'])
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
    const api = new QQApiClient({} as never, { replyFormat: 'markdown' } as never)
    const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
    const first = api.createPrivateTextStream(account, 'user-1', { messageId: 'incoming-1' })
    const second = api.createPrivateTextStream(account, 'user-1', { messageId: 'incoming-2' })
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
    const api = new QQApiClient({} as never, { replyFormat: 'markdown' } as never)
    const stream = api.createPrivateTextStream(
      { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never,
      'user-1',
      { messageId: 'incoming-queued' },
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

test('QQ file upload confirms parts and sends media to the selected chat', async () => {
  const originalFetch = globalThis.fetch
  const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
  for (const group of [false, true]) {
    const paths: string[] = []
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.includes('getAppAccessToken')) return response({ access_token: 'fixture', expires_in: 3600 })
      paths.push(url.pathname)
      if (init?.method === 'PUT') {
        assert.equal(init.redirect, 'error')
        assert.equal(new Headers(init.headers).has('Authorization'), false)
        return response({})
      }
      bodies.push(JSON.parse(String(init?.body)))
      if (url.pathname.endsWith('/upload_prepare')) {
        return response({ upload_id: 'upload', block_size: '8', parts: [{ index: 1, presigned_url: 'https://bucket.myqcloud.com/part' }] })
      }
      if (url.pathname.endsWith('/files')) return response({ file_info: 'file-info' })
      if (url.pathname.endsWith('/messages')) {
        if (group && bodies.at(-1)?.msg_id) return new Response(JSON.stringify({ code: 40034128 }), { status: 400 })
        return response({ id: 'sent' })
      }
      return response({})
    }
    try {
      const api = new QQApiClient({} as never, {} as never)
      await api.sendFile(account, 'target', 'fixture.txt', Buffer.from('fixture'), {
        group, messageId: group ? 'incoming' : null,
      })
      const path = `/v2/${group ? 'groups' : 'users'}/target`
      assert.deepEqual(paths, [`${path}/upload_prepare`, '/part', `${path}/upload_part_finish`, `${path}/files`,
        `${path}/messages`, ...(group ? [`${path}/messages`] : [])])
      assert.equal(bodies[0]?.file_type, 4)
      assert.deepEqual(bodies.at(-1)?.media, { file_info: 'file-info' })
      assert.equal(bodies.at(-1)?.msg_type, 7)
      assert.equal(bodies.at(-1)?.msg_id, undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
})

test('QQ voice sends native voice media in private and group chats', async () => {
  const { encode } = await import('silk-wasm')
  const voice = Buffer.from((await encode(Buffer.alloc(9600), 24_000)).data)
  const originalFetch = globalThis.fetch
  const account = { id: 1, app_id: 'app', app_secret: 'secret', sandbox: false } as never
  const api = new QQApiClient({} as never, {} as never)
  for (const group of [false, true]) {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.includes('getAppAccessToken')) return response({ access_token: 'fixture', expires_in: 3600 })
      if (init?.method === 'PUT') return response({})
      calls.push({ path, body: JSON.parse(String(init?.body)) })
      if (path.endsWith('/upload_prepare')) return response({ upload_id: 'upload', block_size: voice.length, parts: [{ index: 1, presigned_url: 'https://bucket.myqcloud.com/part' }] })
      if (path.endsWith('/files')) return response({ file_info: 'voice-info' })
      return response({ id: 'sent' })
    }
    try {
      await api.sendVoice(account, 'target', voice, { group })
      await api.sendVoice(account, 'target', voice, { group, messageId: 'incoming' })
      const path = `/v2/${group ? 'groups' : 'users'}/target`
      assert.deepEqual(calls.map(call => call.path), ['upload_prepare', 'upload_part_finish', 'files', 'messages', 'upload_prepare', 'upload_part_finish', 'files', 'messages'].map(stage => `${path}/${stage}`))
      assert.equal(calls[0]?.body.file_type, 3)
      assert.equal(calls[0]?.body.file_size, voice.length)
      assert.equal(calls[3]?.body.msg_type, 7)
      assert.deepEqual(calls[3]?.body.media, { file_info: 'voice-info' })
      assert.equal(calls[3]?.body.content, undefined)
      assert.equal(calls[3]?.body.msg_id, undefined)
      assert.equal(calls[7]?.body.msg_id, 'incoming')
    } finally {
      globalThis.fetch = originalFetch
    }
  }
})

test('文件上传明确返回 401 时刷新 Token，最终投递超时只请求一次', async () => {
  const originalFetch = globalThis.fetch
  let tokens = 0
  let prepares = 0
  let deliveries = 0
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.includes('getAppAccessToken')) return response({ access_token: `fixture-${++tokens}`, expires_in: 3600 })
    if (path.endsWith('/upload_prepare')) {
      if (++prepares === 1) return new Response('{}', { status: 401 })
      assert.equal(new Headers(init?.headers).get('authorization'), 'QQBot fixture-2')
      return response({ upload_id: 'upload', block_size: 8, parts: [{ index: 1, presigned_url: 'https://bucket.myqcloud.com/part' }] })
    }
    if (path.endsWith('/files')) return response({ file_info: 'file-info' })
    if (path.endsWith('/messages')) {
      deliveries++
      throw new DOMException('测试超时', 'TimeoutError')
    }
    return response({})
  }
  try {
    const api = new QQApiClient({} as never, {} as never)
    const account = { id: 1, app_id: 'app', app_secret: 'fixture', sandbox: false } as never
    await assert.rejects(api.sendFile(account, 'target', 'fixture.txt', Buffer.from('fixture'), { group: true, messageId: 'incoming' }), /投递结果未知/)
    assert.deepEqual([tokens, prepares, deliveries], [2, 2, 1])
  } finally {
    globalThis.fetch = originalFetch
  }
})
