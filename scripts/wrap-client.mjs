import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const root = resolve('.client-build')
const names = (await readdir(root, { recursive: true }))
  .filter(name => name.endsWith('.cjs'))
  .sort()

const modules = []
for (const name of names) {
  const absolute = resolve(root, name)
  const id = `./${relative(root, absolute).split(sep).join('/')}`
  const body = await readFile(absolute, 'utf8')
  modules.push(`${JSON.stringify(id)}: function(module, exports, require) {\n${body}\n}`)
}

const wrapped = `window.__ModuleLoader__.load({ id: "dsh-qqchat", factory: (require) => {\nvar __qqModules = {\n${modules.join(',\n')}\n};\nvar __qqCache = Object.create(null);\nfunction __qqRequire(id) {\n  var factory = __qqModules[id];\n  if (!factory) return require(id);\n  var cached = __qqCache[id];\n  if (cached) return cached.exports;\n  var module = { exports: {} };\n  __qqCache[id] = module;\n  factory(module, module.exports, __qqRequire);\n  return module.exports;\n}\nreturn __qqRequire("./plugin.cjs");\n} })\n`
await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', wrapped, 'utf8')
await rm('.client-build', { recursive: true, force: true })
