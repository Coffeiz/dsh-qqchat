import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { QQChatDatabase } from '../storage/db.js'

/** Exposes stored QQ images by attachment ID when a model explicitly requests one. */
export function registerQQImageTool(ctx: Context, db: QQChatDatabase, isAllowed: (agentId: string, attachmentId: string) => boolean = () => true): () => void {
  const definition = defineTool({
    name: 'qqchat_describe_image',
    description: '按 attachment_id 主动重新读取 QQ 消息中的图片。正常图片消息由 DSH 原生视觉输入链路直接处理；本工具用于模型需要再次读取指定图片的场景。',
    parameters: {
      attachment_id: { type: 'string', required: true, description: 'QQChat 图片附件 ID' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          attachment_id: { type: 'string' },
          filename: { type: 'string' },
          media_type: { type: 'string' },
          bytes: { type: 'number' },
          image_ref: { type: 'json' },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (!value.ok) return [{ type: 'text', text: value.error || '图片不可用。' }]
        if (!value.image_ref || typeof value.image_ref !== 'object') return [{ type: 'text', text: '图片已找到，但当前 DSH 没有可用的图片附件服务。' }]
        return [
          { type: 'text', text: `已加载图片：${value.filename || value.attachment_id}` },
          { type: 'image', attachment: value.image_ref as never },
        ]
      },
    },
    async execute(args, exec) {
      const attachment = db.attachmentById(args.attachment_id)
      if (!attachment || attachment.kind !== 'image' || !attachment.imageRef) {
        return { ok: false, attachment_id: args.attachment_id, error: '找不到可查看的 QQ 图片附件。' }
      }
      const agent = exec.agent as unknown as { id?: string; options?: { provider?: string; model?: string } } | undefined
      if (!isAllowed(String(agent?.id || ''), args.attachment_id)) {
        return { ok: false, attachment_id: args.attachment_id, error: '当前 QQ 消息没有权限访问这张图片。' }
      }
      if (agent?.options?.provider && agent.options.model) {
        try {
          const info = await ctx.llm.resolveModelInfo(agent.options.provider, agent.options.model, exec.signal)
          if (!info.inputModalities?.includes('image')) {
            return { ok: false, attachment_id: args.attachment_id, error: '当前模型不支持图片输入。' }
          }
        } catch {
          return { ok: false, attachment_id: args.attachment_id, error: '无法确认当前模型是否支持图片输入。' }
        }
      }
      return {
        ok: true, attachment_id: attachment.id, filename: attachment.filename,
        media_type: attachment.imageRef.mediaType, bytes: attachment.sizeBytes, image_ref: { ...attachment.imageRef },
      }
    },
  })
  return ctx.tools.register(definition)
}
