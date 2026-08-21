import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveQQSessionPreset } from '../src/session/agent-bridge.js'

const header = { version: 0, id: 'qqchat-test', createdAt: 1, agentPreset: 'default' } as unknown as SessionHeader

test('session preset resolution prefers the latest persisted selection', () => {
  const events = [
    { type: 'agent-preset/selected', seq: 1, time: 1, data: { agentPreset: 'first' } },
    { type: 'agent-preset/selected', seq: 2, time: 2, data: { agentPreset: 'second' } },
  ] as unknown as SessionEvent[]
  assert.equal(resolveQQSessionPreset(header, events), 'second')
})

test('session preset resolution falls back to the creation header', () => {
  assert.equal(resolveQQSessionPreset(header, []), 'default')
})
