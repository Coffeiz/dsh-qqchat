import test from 'node:test'
import assert from 'node:assert/strict'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { dispatchQQCommand, qqCommandText, slashCommandName } from '../src/commands/dispatch.js'

const agent = {} as never

function runtime(execute: CommandRuntime['execute']): CommandRuntime {
  return {
    execute,
    find: () => undefined,
    list: () => [{ name: 'compact', description: 'Compact history' }],
  } as unknown as CommandRuntime
}

test('slash command names require a valid DSH command prefix', () => {
  assert.equal(slashCommandName('/compact'), 'compact')
  assert.equal(slashCommandName('/goal edit something'), 'goal')
  assert.equal(slashCommandName(' /compact'), undefined)
  assert.equal(slashCommandName('/Bad'), undefined)
})

test('QQ commands may follow a bot mention in group messages', () => {
  assert.equal(qqCommandText('/help', true), '/help')
  assert.equal(qqCommandText('@Bot /help', true), '/help')
  assert.equal(qqCommandText('<@!bot-id> /goal show', true), '/goal show')
  assert.equal(qqCommandText('@someone /help', false), undefined)
})

test('QQ dispatch executes native commands without sending them to the model', async () => {
  let received = ''
  const commands = runtime(async (_agent, input) => {
    received = input
    return { commandId: 'command-1' as never, result: { kind: 'success', text: 'Compacted.' } }
  })
  const result = await dispatchQQCommand(commands, agent, '/compact')
  assert.equal(received, '/compact')
  assert.deepEqual(result, { handled: true, text: 'Compacted.' })
})

test('QQ dispatch reports unknown commands instead of forwarding them', async () => {
  const commands = runtime(async () => undefined)
  const result = await dispatchQQCommand(commands, agent, '/does-not-exist')
  assert.equal(result.handled, true)
  assert.match(result.text || '', /未知或格式无效的命令/u)
  assert.match(result.text || '', /\/compact/u)
})
