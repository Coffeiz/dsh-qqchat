import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
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

test('registers CLI, plugin, and persistence split-tree session copies', async () => {
  const root = resolve('tests/fixtures/session-registration')
  const cliEntry = resolve(root, 'cli/entry.js')
  const pluginEntry = resolve(root, 'plugin/entry.js')
  const registered = await registerQQChatSessionEventType({ anchors: [cliEntry, pluginEntry], argv: ['node', cliEntry] })

  const cliRequire = createRequire(cliEntry)
  const pluginRequire = createRequire(pluginEntry)
  const persistenceRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-session-persistence'))
  const cliSession = await import(cliRequire.resolve('@deepseek-ai/dsh-session')) as { KNOWN_SESSION_EVENT_TYPES: Set<string> }
  const pluginSession = await import(pluginRequire.resolve('@deepseek-ai/dsh-session')) as { KNOWN_SESSION_EVENT_TYPES: Set<string> }
  const persistenceSession = await import(persistenceRequire.resolve('@deepseek-ai/dsh-session')) as { KNOWN_SESSION_EVENT_TYPES: Set<string> }

  assert.ok(registered >= 3)
  assert.equal(cliSession.KNOWN_SESSION_EVENT_TYPES.has('qqchat/message'), true)
  assert.equal(pluginSession.KNOWN_SESSION_EVENT_TYPES.has('qqchat/message'), true)
  assert.equal(persistenceSession.KNOWN_SESSION_EVENT_TYPES.has('qqchat/message'), true)
})
