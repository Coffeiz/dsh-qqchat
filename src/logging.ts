import type { LogLevel, LoggerLike, PluginLogEntry } from './types.js'

export class QQChatLogger implements LoggerLike {
  private nextId = 1
  private readonly entries: PluginLogEntry[] = []

  constructor(
    private readonly base: LoggerLike = console,
    private readonly maxEntries = 500,
  ) {}

  debug = (...args: unknown[]): void => this.write('debug', args)
  info = (...args: unknown[]): void => this.write('info', args)
  warn = (...args: unknown[]): void => this.write('warn', args)
  error = (...args: unknown[]): void => this.write('error', args)

  list(limit = 200): PluginLogEntry[] {
    const safe = Math.max(1, Math.min(this.maxEntries, Math.trunc(limit || 200)))
    return this.entries.slice(-safe)
  }

  private write(level: LogLevel, args: unknown[]): void {
    const message = args.map(formatArg).join(' ')
    this.entries.push({ id: this.nextId++, time: Date.now(), level, message })
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries)
    const sink = this.base[level] ?? this.base.info
    if (sink) sink.call(this.base, ...args)
    else (console[level] ?? console.log)(...args)
  }
}

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}
