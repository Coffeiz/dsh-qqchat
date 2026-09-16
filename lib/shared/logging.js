export class QQChatLogger {
    base;
    maxEntries;
    nextId = 1;
    entries = [];
    constructor(base = console, maxEntries = 500) {
        this.base = base;
        this.maxEntries = maxEntries;
    }
    debug = (...args) => this.write('debug', args);
    info = (...args) => this.write('info', args);
    warn = (...args) => this.write('warn', args);
    error = (...args) => this.write('error', args);
    list(limit = 200) {
        const safe = Math.max(1, Math.min(this.maxEntries, Math.trunc(limit || 200)));
        return this.entries.slice(-safe);
    }
    write(level, args) {
        const message = args.map(formatArg).join(' ');
        this.entries.push({ id: this.nextId++, time: Date.now(), level, message });
        if (this.entries.length > this.maxEntries)
            this.entries.splice(0, this.entries.length - this.maxEntries);
        const sink = this.base[level] ?? this.base.info;
        if (sink)
            sink.call(this.base, ...args);
        else
            (console[level] ?? console.log)(...args);
    }
}
function formatArg(value) {
    if (value instanceof Error)
        return value.stack || value.message;
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
