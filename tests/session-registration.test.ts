import assert from 'node:assert/strict'
import test from 'node:test'
import { registerQQChatSessionEventType } from '../src/session/registration.js'

test('registers the QQ display event in the reachable DSH session vocabulary', async () => {
  assert.ok(await registerQQChatSessionEventType() >= 1)
})
