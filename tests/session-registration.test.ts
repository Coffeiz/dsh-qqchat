import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { loadQQChatPluginRecordWriters, profileNameFromArgv } from '../src/session/registration.js'

test('parses a separated or inline DSH profile argument', () => {
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile', 'web']), 'web')
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile=qqchat']), 'qqchat')
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile']), undefined)
})

test('resolves CLI, plugin, and persistence split-tree session copies', async () => {
  const root = resolve('tests/fixtures/session-registration')
  const cliEntry = resolve(root, 'cli/entry.js')
  const pluginEntry = resolve(root, 'plugin/entry.js')
  const resolved = await loadQQChatPluginRecordWriters({ anchors: [cliEntry, pluginEntry], argv: ['node', cliEntry] })

  const cliRequire = createRequire(cliEntry)
  const pluginRequire = createRequire(pluginEntry)
  const persistenceRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-session-persistence'))
  const cliSession = await import(cliRequire.resolve('@deepseek-ai/dsh-session')) as { appendPluginRecord?: unknown }
  const pluginSession = await import(pluginRequire.resolve('@deepseek-ai/dsh-session')) as { appendPluginRecord?: unknown }
  const persistenceSession = await import(persistenceRequire.resolve('@deepseek-ai/dsh-session')) as { appendPluginRecord?: unknown }

  assert.equal(resolved, 3)
  assert.equal(typeof cliSession.appendPluginRecord, 'function')
  assert.equal(typeof pluginSession.appendPluginRecord, 'function')
  assert.equal(typeof persistenceSession.appendPluginRecord, 'function')
})
