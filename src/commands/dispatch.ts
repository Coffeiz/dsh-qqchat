import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor, CommandExecution, CommandRuntime } from '@deepseek-ai/dsh-commands'

export interface QQCommandReply {
  handled: boolean
  text?: string
}

/** Normalize a QQ command that may be prefixed by the bot mention. */
export function qqCommandText(text: string, mentioned: boolean): string | undefined {
  const input = text.trim()
  if (/^\/[a-z][a-z0-9_-]*(?:\s|$)/u.test(input)) return input
  if (!mentioned) return undefined
  const prefixed = /^(?:<@!?[^>]+>|@[^\s]+)\s*(\/[a-z][a-z0-9_-]*(?:\s|$).*)$/su.exec(input)
  return prefixed?.[1]?.trim()
}

/** Return the command name from a complete slash-command line. */
export function slashCommandName(input: string): string | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=\s|$)/u.exec(input)
  return match?.[1]
}

function renderCommandList(commands: readonly CommandDescriptor[]): string {
  if (commands.length === 0) return '当前 DSH 没有可用命令。'
  return ['可用 DSH 命令：', ...commands.map(command => {
    const hint = command.input?.hint ? ` ${command.input.hint}` : ''
    return `/${command.name}${hint} — ${command.description}`
  })].join('\n')
}

/** Dispatch one QQ slash command through DSH's native command registry. */
export async function dispatchQQCommand(
  commands: CommandRuntime,
  agent: Agent,
  input: string,
): Promise<QQCommandReply> {
  if (!input.startsWith('/')) return { handled: false }

  const name = slashCommandName(input)
  if (name === undefined) return { handled: true, text: '命令格式无效。发送 /help 查看可用命令。' }

  // QQ has no browser download channel for the Web-only command.
  if (name === 'export' && commands.find(agent, name) !== undefined) {
    return { handled: true, text: '/export 仅支持 DSH Web 下载会话日志，QQ 中暂不支持。' }
  }

  const execution: CommandExecution | undefined = await commands.execute(
    agent,
    input,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) {
    return { handled: true, text: `未知或格式无效的命令：/${name}\n\n${renderCommandList(commands.list(agent))}` }
  }

  return { handled: true, text: execution.result.text?.trim() || `/${name} 已执行。` }
}
