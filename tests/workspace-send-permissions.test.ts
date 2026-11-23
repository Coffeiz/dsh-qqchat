import assert from 'node:assert/strict'
import test from 'node:test'
import { DshQQBridge, type QQFileSource } from '../src/session/agent-bridge.js'

test('文件和语音工具在私聊与群聊均要求 Owner 才能使用路径', async () => {
  type Tool = { name: string; execute(args: { path: string }, exec: { agent: { id: string } }): Promise<string> }
  const tools = new Map<string, Tool>()
  const noop = () => () => {}
  let ownerUserId = ''
  const bridge = new DshQQBridge({
    on: noop,
    commands: { register: noop },
    tools: { register(tool: Tool) { tools.set(tool.name, tool); return () => {} } },
  } as never, { runtimeSettings: () => ({ ownerUserId }) } as never, {} as never, {} as never)
  const state = bridge as unknown as {
    activeActors: Map<string, { chatType: string; senderId: string }>
    fileSenders: Map<string, { workspace: string; send: (source: QQFileSource, voice: boolean) => Promise<string> }>
  }
  const sent: boolean[] = []
  state.fileSenders.set('agent', { workspace: '/workspace', async send(source, voice) {
    assert.deepEqual(source, { path: 'fixture.wav', workspace: '/workspace' })
    sent.push(voice)
    return '已发送'
  } })
  for (const chatType of ['c2c', 'group']) {
    state.activeActors.set('agent', { chatType, senderId: 'sender' })
    for (const toolName of ['qqchat_send_file', 'qqchat_send_voice']) {
      const execute = () => tools.get(toolName)!.execute({ path: 'fixture.wav' }, { agent: { id: 'agent' } })
      for (const owner of ['', 'other']) {
        ownerUserId = owner
        assert.match(await execute(), /仅 Owner/)
      }
      ownerUserId = 'sender'
      assert.equal(await execute(), '已发送')
    }
  }
  assert.deepEqual(sent, [false, true, false, true])
})
