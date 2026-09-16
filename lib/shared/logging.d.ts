import type { LoggerLike, PluginLogEntry } from '../types.js';
export declare class QQChatLogger implements LoggerLike {
    private readonly base;
    private readonly maxEntries;
    private nextId;
    private readonly entries;
    constructor(base?: LoggerLike, maxEntries?: number);
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    list(limit?: number): PluginLogEntry[];
    private write;
}
