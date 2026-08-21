import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonObject } from '../src/storage/memory.js'

test('memory reflection parser accepts fenced JSON and surrounding prose', () => {
  const json = JSON.stringify({ summary: '保留"引号"' })
  const parsed = parseJsonObject('这是整理结果：\n```json\n' + json + '\n```\n以上。') as { summary: string }
  assert.equal(parsed.summary, '保留"引号"')
})

test('memory reflection parser rejects non-object output', () => {
  assert.throws(() => parseJsonObject('没有 JSON'), /没有返回有效 JSON/)
  assert.throws(() => parseJsonObject('[]'), /没有返回有效 JSON/)
})
