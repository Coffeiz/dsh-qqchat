import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openWorkspaceFile, resolveWorkspaceFile } from '../src/media/workspace-file.js'

test('工作区文件支持相对路径和绝对路径，拒绝越界或非普通文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qqchat-workspace-'))
  try {
    const workspace = join(root, 'work')
    const outside = join(root, 'work-other')
    await mkdir(workspace)
    await mkdir(outside)
    const inside = join(workspace, 'report.txt')
    const external = join(outside, 'report.txt')
    await writeFile(inside, '合成文件')
    await writeFile(external, '外部文件')
    await symlink(outside, join(workspace, 'outside'))
    for (const path of ['report.txt', inside]) {
      const file = await openWorkspaceFile(await resolveWorkspaceFile(workspace, path))
      try {
        assert.equal(await file.readFile('utf8'), '合成文件')
      } finally {
        await file.close()
      }
    }
    for (const path of ['../work-other/report.txt', external, 'outside/report.txt', '', '.']) {
      await assert.rejects(resolveWorkspaceFile(workspace, path))
    }
    await assert.rejects(resolveWorkspaceFile('relative-workspace', 'report.txt'))
    const resolved = await resolveWorkspaceFile(workspace, 'report.txt')
    await rm(inside)
    await mkdir(inside)
    await assert.rejects(openWorkspaceFile(resolved))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
