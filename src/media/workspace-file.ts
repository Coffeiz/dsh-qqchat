import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

interface WorkspaceFile { root: string; path: string }

function contains(root: string, path: string): boolean {
  const child = relative(root, path)
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

export async function resolveWorkspaceFile(workspace: string, input: string): Promise<WorkspaceFile> {
  if (!isAbsolute(workspace) || !input.trim()) throw new Error('工作区路径无效')
  const root = await realpath(workspace)
  const requested = resolve(workspace, input)
  if (!contains(workspace, requested) && !contains(root, requested)) throw new Error('路径超出工作区')
  const path = await realpath(requested)
  if (!contains(root, path)) throw new Error('路径超出工作区')
  return { root, path }
}

export async function openWorkspaceFile({ root, path }: WorkspaceFile) {
  // 禁止末端链接和阻塞式打开。核对已打开对象仍对应工作区内的路径。
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const current = await realpath(path)
    if (!contains(root, current)) throw new Error('路径超出工作区')
    const [opened, named] = await Promise.all([file.stat(), stat(current)])
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino) throw new Error('工作区文件已变化')
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}
