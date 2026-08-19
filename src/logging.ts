import type { Logger } from '@deepseek-ai/cordis'
import type { LogEntry, LogLevel } from './types.js'

const MAX_ENTRIES = 500

/** Small in-memory mirror of plugin logs for the Settings log viewer. */
export class QQChatLogger {
  private readonly entries: LogEntry[] = []

  constructor(private readonly logger: Logger) {}

  debug(message: string): void { this.write('debug', message) }
  info(message: string): void { this.write('info', message) }
  warn(message: string): void { this.write('warn', message) }
  error(message: string): void { this.write('error', message) }

  list(limit = 200): LogEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES))).reverse()
  }

  private write(level: LogLevel, message: string): void {
    const entry: LogEntry = { level, message, time: Date.now() }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.logger[level](message)
  }
}
