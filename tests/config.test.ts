import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultRuntimeSettings, resolveConfig } from '../src/config.js'

test('Markdown is the direct-chat default and groups keep plain compatibility by default', () => {
  const config = resolveConfig()
  const settings = defaultRuntimeSettings(config)
  assert.equal(config.replyFormat, 'markdown')
  assert.equal(settings.directReplyFormat, 'markdown')
  assert.equal(settings.groupReplyFormat, 'compat')
})

test('legacy smart configuration resolves to Markdown', () => {
  assert.equal(resolveConfig({ replyFormat: 'smart' as never }).replyFormat, 'markdown')
  assert.equal(resolveConfig({ replyFormat: 'compat' }).replyFormat, 'compat')
})
