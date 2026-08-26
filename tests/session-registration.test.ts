import assert from 'node:assert/strict'
import test from 'node:test'
import { profileNameFromArgv, registerQQChatSessionEventType } from '../src/session/registration.js'

test('parses a separated or inline DSH profile argument', () => {
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile', 'web']), 'web')
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile=qqchat']), 'qqchat')
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile']), undefined)
})

test('registers the QQ display event in the reachable DSH session vocabulary', async () => {
  assert.ok(await registerQQChatSessionEventType() >= 1)
})
