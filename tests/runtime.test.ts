import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldReplyToGroup } from '../src/session/runtime.js'

const group = { enabled: 1 as const, read_enabled: 1 as const }

test('global auto mode replies for existing groups regardless of legacy requires_at', () => {
  assert.equal(shouldReplyToGroup('auto', group, false), true)
})

test('global mention mode only replies when the bot is mentioned', () => {
  assert.equal(shouldReplyToGroup('mention', group, false), false)
  assert.equal(shouldReplyToGroup('mention', group, true), true)
})

test('global silent mode does not reply even when the bot is mentioned', () => {
  assert.equal(shouldReplyToGroup('silent', group, true), false)
})

test('disabled or unreadable groups never reply', () => {
  assert.equal(shouldReplyToGroup('auto', { enabled: 0, read_enabled: 1 }, false), false)
  assert.equal(shouldReplyToGroup('auto', { enabled: 1, read_enabled: 0 }, false), false)
})
