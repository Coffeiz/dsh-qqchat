import { normalizeQQDispatch } from './normalize.js';
const OP = {
    DISPATCH: 0,
    HEARTBEAT: 1,
    IDENTIFY: 2,
    RESUME: 6,
    RECONNECT: 7,
    INVALID_SESSION: 9,
    HELLO: 10,
    HEARTBEAT_ACK: 11,
};
const INTENTS = 1 << 25;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
export class QQGateway {
    account;
    db;
    api;
    onMessage;
    logger;
    stopped = false;
    ws;
    sessionId;
    lastSeq = null;
    heartbeatTimer;
    ackTimer;
    lastAckAt = 0;
    loopPromise;
    dispatchChains = new Map();
    constructor(account, db, api, onMessage, logger = console) {
        this.account = account;
        this.db = db;
        this.api = api;
        this.onMessage = onMessage;
        this.logger = logger;
    }
    start() {
        if (this.loopPromise)
            return;
        this.stopped = false;
        this.loopPromise = this.loop().finally(() => { this.loopPromise = undefined; });
    }
    async stop() {
        this.stopped = true;
        this.clearHeartbeat();
        try {
            this.ws?.close();
        }
        catch { }
        try {
            await this.loopPromise;
        }
        catch { }
        this.db.setAccountGateway(this.account.id, 'offline', null);
    }
    async loop() {
        let attempt = 0;
        while (!this.stopped) {
            try {
                this.db.setAccountGateway(this.account.id, 'connecting', null);
                await this.connectOnce();
                attempt = 0;
            }
            catch (error) {
                if (this.stopped)
                    break;
                const message = error instanceof Error ? error.message : String(error);
                this.db.setAccountGateway(this.account.id, 'error', message.slice(0, 500));
                this.logger.warn?.(`[dsh-qqchat] QQ gateway: ${message}`);
                const delay = RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)] ?? RECONNECT_DELAYS.at(-1) ?? 60_000;
                await sleep(delay);
            }
        }
    }
    async connectOnce() {
        // Resolve the URL first. gatewayUrl may invalidate and refresh a stale
        // cached token after a 401; fetching the identify token in parallel could
        // otherwise retain the pre-refresh token for the WebSocket handshake.
        const url = await this.api.gatewayUrl(this.account);
        const token = await this.api.token(this.account);
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            this.ws = ws;
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                this.clearHeartbeat();
                this.ws = undefined;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            ws.addEventListener('error', () => finish(new Error('QQ WebSocket 连接错误')));
            ws.addEventListener('close', event => {
                if (this.stopped)
                    finish();
                else
                    finish(new Error(`QQ WebSocket 已断开 (${event.code})`));
            });
            ws.addEventListener('message', event => {
                this.handleFrame(ws, token, event.data).catch(error => {
                    try {
                        ws.close();
                    }
                    catch { }
                    finish(error instanceof Error ? error : new Error(String(error)));
                });
            });
        });
    }
    async handleFrame(ws, token, raw) {
        const text = await asText(raw);
        const frame = JSON.parse(text);
        if (typeof frame.s === 'number')
            this.lastSeq = frame.s;
        switch (frame.op) {
            case OP.HELLO: {
                const interval = Number(frame.d?.heartbeat_interval || 45_000);
                this.installHeartbeat(ws, interval);
                if (this.sessionId) {
                    this.send(ws, OP.RESUME, { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq });
                }
                else {
                    this.send(ws, OP.IDENTIFY, {
                        token: `QQBot ${token}`,
                        intents: INTENTS,
                        shard: [0, 1],
                        properties: { $os: process.platform, $browser: 'dsh-qqchat', $device: 'dsh-qqchat' },
                    });
                }
                break;
            }
            case OP.HEARTBEAT_ACK:
                this.lastAckAt = Date.now();
                break;
            case OP.RECONNECT:
                ws.close(4000, 'server reconnect');
                break;
            case OP.INVALID_SESSION:
                this.sessionId = undefined;
                this.lastSeq = null;
                ws.close(4001, 'invalid session');
                break;
            case OP.DISPATCH:
                await this.handleDispatch(frame.t || '', frame.d || {});
                break;
        }
    }
    async handleDispatch(type, data) {
        if (type === 'READY') {
            const sessionId = data.session_id;
            this.sessionId = typeof sessionId === 'string' && sessionId ? sessionId : this.sessionId;
            const user = isRecord(data.user) ? data.user : undefined;
            const botUserId = String(user?.id || user?.openid || '') || undefined;
            this.db.setAccountGateway(this.account.id, 'online', null, botUserId);
            return;
        }
        if (type === 'RESUMED') {
            this.db.setAccountGateway(this.account.id, 'online', null);
            return;
        }
        const message = normalizeQQDispatch(type, data, Number(this.account.id));
        if (message)
            await this.enqueueMessage(message);
    }
    enqueueMessage(message) {
        const key = `${this.account.id}:${message.chatType}:${message.chatId}`;
        const previous = this.dispatchChains.get(key) || Promise.resolve();
        const current = previous.catch(() => undefined).then(() => this.onMessage(message));
        this.dispatchChains.set(key, current);
        return current.finally(() => {
            if (this.dispatchChains.get(key) === current)
                this.dispatchChains.delete(key);
        });
    }
    installHeartbeat(ws, interval) {
        this.clearHeartbeat();
        this.lastAckAt = Date.now();
        const tick = () => {
            if (ws.readyState !== WebSocket.OPEN)
                return;
            if (Date.now() - this.lastAckAt > interval * 2.5) {
                ws.close(4002, 'heartbeat timeout');
                return;
            }
            this.send(ws, OP.HEARTBEAT, this.lastSeq);
        };
        this.heartbeatTimer = setInterval(tick, interval);
        const firstTick = setTimeout(tick, Math.min(1000, interval));
        firstTick.unref?.();
    }
    clearHeartbeat() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        if (this.ackTimer)
            clearTimeout(this.ackTimer);
        this.heartbeatTimer = undefined;
        this.ackTimer = undefined;
    }
    send(ws, op, data) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ op, d: data }));
    }
}
async function asText(data) {
    if (typeof data === 'string')
        return data;
    if (data instanceof ArrayBuffer)
        return Buffer.from(data).toString('utf8');
    if (ArrayBuffer.isView(data))
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    if (data instanceof Blob)
        return data.text();
    return String(data);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
