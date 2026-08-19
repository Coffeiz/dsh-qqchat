import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const body = await readFile('.client-build/plugin.cjs', 'utf8')
const wrapped = `window.__ModuleLoader__.load({ id: "dsh-qqchat", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;\n${body}\nreturn module.exports\n} })\n`
await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', wrapped, 'utf8')
await rm('.client-build', { recursive: true, force: true })
