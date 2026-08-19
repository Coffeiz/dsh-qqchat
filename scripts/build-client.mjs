import { readFile, writeFile } from 'node:fs/promises'

const id = 'dsh-qqchat'
const body = await readFile(new URL('../client-src/plugin.cjs', import.meta.url), 'utf8')
const output = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  body,
  'return module.exports; } });',
  '',
].join('\n')
await writeFile(new URL('../lib/client.js', import.meta.url), output)
