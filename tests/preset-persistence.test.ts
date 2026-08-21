import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveQQSessionPreset } from '../src/session/agent-bridge.js'

test('Host Session events survive the persistence inspection boundary for preset recovery', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)

  const sessionId = SessionId('qqchat-preset-persistence')
  const header: SessionHeader = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
  const persisted: SessionEvent[] = []
  ctx.provide('sessionPersistence', {
    inspect: async () => ({ meta: header, events: structuredClone(persisted) }),
  } as never)
  const dispose = ctx.on('session/event', (_session, event) => {
    persisted.push(structuredClone(event))
  })

  const session = ctx.sessions.create(sessionId, { meta: header })
  session.append('agent-preset/selected', { agentPreset: 'code' })
  const inspection = await (ctx as unknown as { sessionPersistence: { inspect(id: typeof sessionId): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> } }).sessionPersistence.inspect(sessionId)

  assert.equal(resolveQQSessionPreset(inspection.meta, inspection.events), 'code')
  dispose()
  await ctx.fiber.dispose()
})
