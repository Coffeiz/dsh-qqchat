import assert from 'node:assert/strict'
import test from 'node:test'
import { DshQQBridge } from '../src/session/agent-bridge.js'

function createBridge(sendText: (...args: unknown[]) => Promise<void>, getSettings: () => Record<string, unknown>) {
  const events = new Map<string, (...args: unknown[]) => void>()
  const noop = () => () => {}
  const bridge = new DshQQBridge({
    on(name: string, handler: (...args: unknown[]) => void) { events.set(name, handler); return () => {} },
    commands: { register: noop },
    tools: { register: noop },
  } as never, {
    runtimeSettings: () => ({
      showToolActivity: true,
      groupReplyFormat: 'compat',
      directReplyFormat: 'markdown',
      ...getSettings(),
    }),
    groupBySession: () => ({ id: 1, account_id: 7, platform_group_id: 'group-1' }),
    memberBySession: () => undefined,
    accountById: () => ({ id: 7 }),
  } as never, {} as never, {} as never, { sendToolActivity: sendText } as never)
  return { bridge, events }
}

function stateOf(bridge: DshQQBridge) {
  return bridge as unknown as {
    activeActors: Map<string, { chatType: 'group'; senderId: string; messageId: string; startedAt: number }>
    toolActivityQueues: Map<string, Promise<void>>
    sendToolActivity(sessionId: string, text: string): void
  }
}

test('工具结果只在 QQ 入站回合中发送，并复用该回合的 message_id', async () => {
  const sends: unknown[][] = []
  const { bridge, events } = createBridge(async (...args) => { sends.push(args) }, () => ({}))
  const state = stateOf(bridge)
  const onResult = events.get('tools/result')!

  onResult({ agent: { id: 'agent-1' }, name: 'glob' }, { isError: false })
  assert.equal(sends.length, 0, 'Web 或其他非 QQ 回合不应向 QQ 推送')

  state.activeActors.set('agent-1', { chatType: 'group', senderId: 'user-1', messageId: 'incoming-1', startedAt: Date.now() })
  onResult({ agent: { id: 'agent-1' }, name: 'glob' }, { isError: false })
  await state.toolActivityQueues.get('agent-1')

  assert.equal(sends.length, 1)
  assert.deepEqual(sends[0]?.slice(1), ['group-1', '✅ 工具调用完成：glob', {
    group: true, messageId: 'incoming-1', format: 'compat',
  }])
})

test('工具状态排队后发送前会重新检查显示开关', async () => {
  const sends: unknown[][] = []
  let showToolActivity = true
  let resolveFirst!: () => void
  let startedFirst!: () => void
  const firstStarted = new Promise<void>(resolve => { startedFirst = resolve })
  const firstSend = new Promise<void>(resolve => { resolveFirst = resolve })
  const { bridge } = createBridge(async (...args) => {
    sends.push(args)
    if (sends.length === 1) {
      startedFirst()
      await firstSend
    }
  }, () => ({ showToolActivity }))
  const state = stateOf(bridge)
  state.activeActors.set('agent-1', { chatType: 'group', senderId: 'user-1', messageId: 'incoming-1', startedAt: Date.now() })

  state.sendToolActivity('agent-1', '第一条')
  state.sendToolActivity('agent-1', '排队的第二条')
  await firstStarted
  showToolActivity = false
  resolveFirst()
  await state.toolActivityQueues.get('agent-1')

  assert.equal(sends.length, 1)
})

test('超过被动消息安全窗口的工具提示会被跳过', async () => {
  const sends: unknown[][] = []
  const { bridge } = createBridge(async (...args) => { sends.push(args) }, () => ({}))
  const state = stateOf(bridge)
  state.activeActors.set('agent-1', {
    chatType: 'group', senderId: 'user-1', messageId: 'incoming-1',
    startedAt: Date.now() - 5 * 60_000,
  })

  state.sendToolActivity('agent-1', '过期提示')
  await state.toolActivityQueues.get('agent-1')

  assert.equal(sends.length, 0)
})
