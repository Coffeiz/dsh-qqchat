import { readFile, stat } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { QQChatDatabase } from '../storage/db.js'

const execFile = promisify(execFileCallback)
const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function registerQQMediaTools(
  ctx: Context,
  db: QQChatDatabase,
  isAllowed: (agentId: string, attachmentId: string) => boolean = () => true,
): () => void {
  const readFileTool = defineTool({
    name: 'qqchat_read_file',
    description: '读取 QQ 消息中的文本文件。传入 QQChat 提供的 attachment_id；二进制文件不会被当作文本读取。',
    parameters: { attachment_id: { type: 'string', required: true, description: 'QQChat 文件附件 ID' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const attachment = db.attachmentById(args.attachment_id)
      const agentId = String((exec.agent as unknown as { id?: string } | undefined)?.id || '')
      if (!attachment || !attachment.localPath || !isAllowed(agentId, args.attachment_id)) return '当前 QQ 消息没有可读取的文件附件。'
      if (attachment.kind !== 'file') return '这个附件不是普通文本文件。'
      if (attachment.sizeBytes > MAX_TEXT_BYTES) return `文件过大，超过 ${MAX_TEXT_BYTES} 字节读取上限。`
      try {
        return await readFile(attachment.localPath, { encoding: 'utf8', signal: exec.signal })
      } catch {
        return '文件读取失败或文件已过期。'
      }
    },
  })

  const mediaInfoTool = defineTool({
    name: 'qqchat_media_info',
    description: '查看 QQ 图片、语音、视频或文件附件的元数据；视频可在服务器安装 ffprobe 时补充流信息。',
    parameters: { attachment_id: { type: 'string', required: true, description: 'QQChat 媒体附件 ID' } },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, info: { type: 'string' }, error: { type: 'string' } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.ok ? (value.info || '{}') : (value.error || '媒体信息不可用。') }],
    },
    async execute(args, exec) {
      const attachment = db.attachmentById(args.attachment_id)
      const agentId = String((exec.agent as unknown as { id?: string } | undefined)?.id || '')
      if (!attachment || !isAllowed(agentId, args.attachment_id)) return { ok: false, error: '当前 QQ 消息没有权限访问这个附件。' }
      const info: Record<string, unknown> = {
        attachmentId: attachment.id, kind: attachment.kind, filename: attachment.filename,
        contentType: attachment.contentType || null, sizeBytes: attachment.sizeBytes,
      }
      if (attachment.localPath) {
        try { info.fileSize = Number((await stat(attachment.localPath)).size) } catch {}
        if (attachment.kind === 'video' || attachment.kind === 'voice' || attachment.kind === 'audio') {
          try {
            const result = await execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', attachment.localPath], { timeout: 10_000, signal: exec.signal })
            info.ffprobe = JSON.parse(result.stdout)
          } catch { info.ffprobe = 'ffprobe 不可用或媒体格式无法探测。' }
        }
      }
      return { ok: true, info: JSON.stringify(info, null, 2) }
    },
  })
  const disposeRead = ctx.tools.register(readFileTool)
  const disposeInfo = ctx.tools.register(mediaInfoTool)
  return () => { disposeInfo(); disposeRead() }
}
