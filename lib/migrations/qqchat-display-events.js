import { copyFile, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { basename, dirname, join } from 'node:path';
import { SessionId } from '@deepseek-ai/dsh-session';
const LEGACY_EVENT = 'qqchat/message';
const PLUGIN_EVENT = 'plugin:qqchat/message';
const PLACEHOLDER_PREFIX = '__dsh_qqchat_display_migration_v1__:';
const MIGRATION_MARKER = '.qqchat-display-events-v4.done';
const SESSION_FILE = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/u;
const SURFACE_EVENTS = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result']);
/** Convert old QQ display events before DSH Web or resume reads their Sessions. */
export async function migrateQQChatSessions(persistence, logger) {
    const sessions = await discoverQQChatSessions(persistence);
    let migratedEvents = 0;
    let failedSessions = 0;
    let deferredSessions = 0;
    for (const item of sessions) {
        const id = item.header.id;
        const path = item.location.path;
        let rollbackBytes;
        let publishedCurrentGeneration = false;
        try {
            const markerPath = join(dirname(path), MIGRATION_MARKER);
            if (await exists(markerPath))
                continue;
            const version = versionFromPath(path);
            const preHead = version < 4 ? await inspectPreHeadSurfaceEvents(path, id) : { positions: new Set(), deferred: false };
            if (preHead.deferred) {
                deferredSessions += 1;
                continue;
            }
            const rewrite = await rewriteFile(path, id, (event, position) => {
                if (preHead.positions.has(position)) {
                    const payload = Buffer.from(JSON.stringify({ kind: 'legacy-qq-surface', data: event.data })).toString('base64url');
                    return {
                        type: 'feedback/record',
                        ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
                        time: event.time,
                        data: { text: PLACEHOLDER_PREFIX + payload },
                    };
                }
                if (event.type === LEGACY_EVENT) {
                    if (version >= 4)
                        return { ...event, type: PLUGIN_EVENT, ignorable: true };
                    if (version === 3)
                        return event.ignorable === true ? undefined : { ...event, ignorable: true };
                    const payload = Buffer.from(JSON.stringify(event.data)).toString('base64url');
                    return { type: 'feedback/record', seq: event.seq, time: event.time, data: { text: PLACEHOLDER_PREFIX + payload } };
                }
                if (version >= 4)
                    return restorePlaceholder(event);
                return normalizeLegacyQQMessageSource(event);
            });
            rollbackBytes = rewrite.original;
            const markerCount = await countMigrationMarkers(path, id);
            const legacyCount = version === 3 ? await countLegacyEvents(path, id) : 0;
            let finalPath = path;
            if (version < 4 && (rewrite.changes > 0 || markerCount > 0 || legacyCount > 0)) {
                const handle = await persistence.open(SessionId(id), 'write');
                await handle.close();
                const current = await persistence.stat(SessionId(id));
                const currentPath = current?.location?.kind === 'jsonl' ? current.location.path : undefined;
                if (!currentPath || versionFromPath(currentPath) < 4) {
                    throw new Error('DSH 未发布已迁移的当前 Session 格式');
                }
                publishedCurrentGeneration = true;
                finalPath = currentPath;
            }
            const pendingDisplays = await countMigrationMarkers(finalPath, id) + await countLegacyEvents(finalPath, id);
            const converted = await rewriteFile(finalPath, id, event => {
                if (event.type === LEGACY_EVENT)
                    return { ...event, type: PLUGIN_EVENT, ignorable: true };
                return restorePlaceholder(event);
            });
            if (converted.changes !== pendingDisplays)
                throw new Error('QQ 展示记录迁移数量校验失败');
            if (await countMigrationMarkers(finalPath, id) !== 0 || await countLegacyEvents(finalPath, id) !== 0) {
                throw new Error('迁移后的 Session 仍含未转换 QQ 展示记录');
            }
            migratedEvents += converted.changes;
            await writeMigrationMarker(join(dirname(finalPath), MIGRATION_MARKER), id);
        }
        catch (error) {
            failedSessions += 1;
            if (!publishedCurrentGeneration && rollbackBytes) {
                try {
                    await restoreOriginal(path, rollbackBytes);
                }
                catch (rollbackError) {
                    logger.warn?.(`[dsh-qqchat] Session 迁移回滚失败 session=${id}: ${rollbackError instanceof Error ? rollbackError.message : '未知错误'}`);
                }
            }
            logger.warn?.(`[dsh-qqchat] Session 迁移失败 session=${id}: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }
    const result = { sessions: sessions.length, migratedEvents, failedSessions, deferredSessions };
    if (sessions.length > 0) {
        logger.info?.(`[dsh-qqchat] Session 迁移检查 sessions=${result.sessions} events=${result.migratedEvents} failed=${result.failedSessions} deferred=${result.deferredSessions}`);
    }
    return result;
}
async function inspectPreHeadSurfaceEvents(path, id) {
    const parsed = await readLog(path, id);
    const events = parsed.events.map(line => JSON.parse(line));
    const firstStepIndex = events.findIndex(event => event.type === 'step/start');
    const firstSurfaceIndex = events.findIndex(event => typeof event.type === 'string' && SURFACE_EVENTS.has(event.type));
    if (firstSurfaceIndex < 0 || (firstStepIndex >= 0 && firstSurfaceIndex >= firstStepIndex)) {
        return { positions: new Set(), deferred: false };
    }
    const boundary = firstStepIndex < 0 ? events.length : firstStepIndex;
    const positions = new Set();
    for (let position = 0; position < boundary; position += 1) {
        const event = events[position];
        if (typeof event.type !== 'string' || !SURFACE_EVENTS.has(event.type))
            continue;
        if (event.type === 'system/message')
            continue;
        if (event.type !== 'user/message' || !isLegacyQQSurfaceData(event.data)) {
            return { positions: new Set(), deferred: true };
        }
        positions.add(position);
    }
    return { positions, deferred: positions.size === 0 };
}
async function discoverQQChatSessions(persistence) {
    const byId = new Map();
    const snapshots = await persistence.list();
    const roots = new Set();
    for (const item of snapshots) {
        if (!item.header.id.startsWith('qqchat-') || item.location?.kind !== 'jsonl' || !item.location.path)
            continue;
        byId.set(item.header.id, item);
        roots.add(dirname(dirname(dirname(item.location.path))));
    }
    for (const root of roots) {
        let projects;
        try {
            projects = await readdir(root, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const project of projects) {
            if (!project.isDirectory())
                continue;
            const projectPath = join(root, project.name);
            let directories;
            try {
                directories = await readdir(projectPath, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const directory of directories) {
                if (!directory.isDirectory() || !directory.name.startsWith('qqchat-'))
                    continue;
                let files;
                try {
                    files = await readdir(join(projectPath, directory.name), { withFileTypes: true });
                }
                catch {
                    continue;
                }
                const candidate = files
                    .filter(file => file.isFile() && SESSION_FILE.test(file.name))
                    .map(file => ({ name: file.name, version: versionFromPath(file.name) }))
                    .sort((left, right) => right.version - left.version || Number(right.name.endsWith('.zstd')) - Number(left.name.endsWith('.zstd')))[0];
                if (!candidate)
                    continue;
                const existing = byId.get(directory.name);
                if (existing?.location?.path && versionFromPath(existing.location.path) > candidate.version)
                    continue;
                byId.set(directory.name, {
                    header: { id: directory.name },
                    location: { kind: 'jsonl', path: join(projectPath, directory.name, candidate.name) },
                });
            }
        }
    }
    return [...byId.values()];
}
function versionFromPath(path) {
    const match = basename(path).match(SESSION_FILE);
    if (!match)
        throw new Error('DSH Session 路径格式不受支持');
    return match[1] ? Number(match[1]) : 0;
}
async function countMigrationMarkers(path, expectedId) {
    const parsed = await readLog(path, expectedId);
    return parsed.events.reduce((count, line) => {
        const event = JSON.parse(line);
        return count + Number(event.type === 'feedback/record' && typeof event.data?.text === 'string' && event.data.text.startsWith(PLACEHOLDER_PREFIX));
    }, 0);
}
async function countLegacyEvents(path, expectedId) {
    const parsed = await readLog(path, expectedId);
    return parsed.events.reduce((count, line) => {
        const event = JSON.parse(line);
        return count + Number(event.type === LEGACY_EVENT);
    }, 0);
}
async function exists(path) {
    try {
        const handle = await open(path, 'r');
        await handle.close();
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
}
async function writeMigrationMarker(path, sessionId) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify({ migration: 1, sessionId }) + '\n');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await rename(temporary, path);
        const dirHandle = await open(dirname(path), 'r');
        try {
            await dirHandle.sync();
        }
        finally {
            await dirHandle.close();
        }
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
function restorePlaceholder(event) {
    const data = event.data;
    if (event.type !== 'feedback/record' || typeof data?.text !== 'string' || !data.text.startsWith(PLACEHOLDER_PREFIX))
        return undefined;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(data.text.slice(PLACEHOLDER_PREFIX.length), 'base64url').toString('utf8'));
    }
    catch {
        return undefined;
    }
    if (isDisplayEvent(payload))
        return { type: PLUGIN_EVENT, seq: event.seq, time: event.time, data: payload, ignorable: true };
    if (typeof payload !== 'object' || payload === null || payload.kind !== 'legacy-qq-surface')
        return undefined;
    const display = legacyQQSurfaceToDisplayEvent(payload.data, event);
    if (!display)
        return undefined;
    return { type: PLUGIN_EVENT, seq: event.seq, time: event.time, data: display, ignorable: true };
}
function isLegacyQQSurfaceData(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const source = value.source;
    if (typeof source !== 'object' || source === null || Array.isArray(source))
        return false;
    const item = source;
    return item.kind === 'user' && item.channel === 'qq'
        && (item.chatType === 'group' || item.chatType === 'c2c')
        && typeof item.chatId === 'string' && item.chatId.length > 0
        && typeof item.senderId === 'string' && item.senderId.length > 0;
}
function legacyQQSurfaceToDisplayEvent(value, event) {
    if (!isLegacyQQSurfaceData(value))
        return undefined;
    const message = value;
    const source = message.source;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const rawText = typeof message.content === 'string'
        ? message.content
        : blocks.flatMap(block => {
            if (typeof block !== 'object' || block === null || block.type !== 'text')
                return [];
            const text = block.text;
            return typeof text === 'string' ? [text] : [];
        }).join('\n');
    const body = rawText.match(/(?:消息)?正文\s*[:：=]\s*\n?([\s\S]*)$/u)?.[1] ?? rawText;
    const chatType = source.chatType;
    const display = {
        messageId: typeof source.messageId === 'string' && source.messageId ? source.messageId : `legacy-${String(event.seq ?? 'unknown')}`,
        chatType,
        chatId: source.chatId,
        direction: 'inbound',
        senderId: source.senderId,
        senderName: typeof source.senderName === 'string' && source.senderName ? source.senderName : 'QQ 用户',
        ...(chatType === 'c2c' ? { isOwner: true } : {}),
        content: body.trim(),
        quotedText: '',
        mentioned: source.mentioned === true,
        createdAt: typeof event.time === 'number' ? event.time : Date.now(),
        legacyMessage: value,
    };
    return display;
}
/** Remove QQ-only source metadata before DSH validates historical message schemas. */
function normalizeLegacyQQMessageSource(event) {
    if (typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) {
        return undefined;
    }
    const data = event.data;
    let changed = false;
    const normalizeMessage = (message) => {
        if (typeof message !== 'object' || message === null || Array.isArray(message))
            return message;
        const record = message;
        const source = record.source;
        if (typeof source !== 'object' || source === null || Array.isArray(source))
            return message;
        const sourceRecord = source;
        if (sourceRecord.kind === 'qq-chat' || sourceRecord.kind === 'qq-chat-bootstrap') {
            changed = true;
            return { ...record, source: { kind: 'user' } };
        }
        if (sourceRecord.kind !== 'user')
            return message;
        const normalized = { kind: 'user' };
        if (typeof sourceRecord.rpcId === 'string')
            normalized.rpcId = sourceRecord.rpcId;
        if (typeof sourceRecord.clientTimeZone === 'string')
            normalized.clientTimeZone = sourceRecord.clientTimeZone;
        if (Object.keys(sourceRecord).length === Object.keys(normalized).length)
            return message;
        changed = true;
        return { ...record, source: normalized };
    };
    if (event.type === 'user/message') {
        const normalized = normalizeMessage(data);
        if (normalized !== data)
            return { ...event, data: normalized };
    }
    else if (event.type === 'agent/inbox/spliced' && Array.isArray(data.inserted)) {
        const inserted = data.inserted.map(normalizeMessage);
        if (changed)
            return { ...event, data: { ...data, inserted } };
    }
    else if (event.type === 'session/title-llm-request' && Array.isArray(data.messages)) {
        const messages = data.messages.map(normalizeMessage);
        if (changed)
            return { ...event, data: { ...data, messages } };
    }
    return changed ? { ...event, data } : undefined;
}
function isDisplayEvent(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const record = value;
    return typeof record.messageId === 'string'
        && (record.chatType === 'group' || record.chatType === 'c2c')
        && (record.direction === 'inbound' || record.direction === 'outbound')
        && typeof record.senderId === 'string'
        && typeof record.senderName === 'string'
        && typeof record.content === 'string'
        && typeof record.quotedText === 'string'
        && typeof record.mentioned === 'boolean'
        && typeof record.createdAt === 'number';
}
async function rewriteFile(path, expectedId, transform) {
    const original = await readFile(path);
    const parsed = parseLog(original, path, expectedId);
    let changes = 0;
    const events = parsed.events.map((line, position) => {
        const event = JSON.parse(line);
        const rewritten = transform(event, position);
        if (!rewritten)
            return line;
        changes += 1;
        return JSON.stringify(rewritten);
    });
    if (changes === 0)
        return { changes: 0 };
    const output = encodeLog(parsed.header, events, parsed.compressed);
    parseLog(output, path, expectedId);
    await preserveAndReplace(path, expectedId, original, output);
    return { changes, original };
}
/** Restore the just-staged source atomically when DSH refuses its own format migration. */
async function restoreOriginal(path, original) {
    const info = await stat(path);
    const temporary = join(dirname(path), `.${basename(path)}.qqchat-rollback-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', info.mode & 0o777);
    try {
        await handle.writeFile(original);
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await rename(temporary, path);
        const dirHandle = await open(dirname(path), 'r');
        try {
            await dirHandle.sync();
        }
        finally {
            await dirHandle.close();
        }
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
async function readLog(path, expectedId) {
    return parseLog(await readFile(path), path, expectedId);
}
function parseLog(bytes, path, expectedId) {
    const compressed = path.endsWith('.zstd');
    const text = (compressed ? zstdDecompressSync(bytes) : bytes).toString('utf8');
    const lines = text.split(/\r?\n/u).filter(line => line.length > 0);
    if (lines.length === 0)
        throw new Error('Session 文件为空');
    const header = JSON.parse(lines[0]);
    const version = versionFromPath(path);
    if (header.type !== 'session' || header.id !== expectedId || header.version !== version) {
        throw new Error('Session header 与持久化索引不匹配');
    }
    for (let index = 1; index < lines.length; index += 1) {
        const event = JSON.parse(lines[index]);
        // v0-v2 stored events before DSH introduced sequence numbers. Keep their
        // original order and let DSH's public write-open migration assign the
        // current sequence values; current generations must already be contiguous.
        if (version >= 3 && event.seq !== index - 1) {
            throw new Error('Session 事件序号不连续，已跳过迁移');
        }
    }
    return { header: lines[0], events: lines.slice(1), compressed };
}
function encodeLog(header, events, compressed) {
    const body = events.length ? `${events.join('\n')}\n` : '';
    if (!compressed)
        return Buffer.from(`${header}\n${body}`);
    const headerFrame = zstdCompressSync(Buffer.from(`${header}\n`));
    return events.length
        ? Buffer.concat([headerFrame, zstdCompressSync(Buffer.from(body))])
        : headerFrame;
}
async function preserveAndReplace(path, expectedId, original, output) {
    const info = await stat(path);
    const id = randomUUID();
    const dir = dirname(path);
    const backup = join(dir, `.${basename(path)}.qqchat-backup-${id}`);
    const temporary = join(dir, `.${basename(path)}.qqchat-migrate-${id}.tmp`);
    await copyFile(path, backup);
    const backupHandle = await open(backup, 'r');
    try {
        await backupHandle.sync();
    }
    finally {
        await backupHandle.close();
    }
    const outputHandle = await open(temporary, 'wx', info.mode & 0o777);
    try {
        await outputHandle.writeFile(output);
        await outputHandle.sync();
    }
    finally {
        await outputHandle.close();
    }
    try {
        const verified = parseLog(await readFile(temporary), path, expectedId);
        if (verified.events.length !== parseLog(original, path, expectedId).events.length) {
            throw new Error('迁移后事件数量校验失败');
        }
        await rename(temporary, path);
        const dirHandle = await open(dir, 'r');
        try {
            await dirHandle.sync();
        }
        finally {
            await dirHandle.close();
        }
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
