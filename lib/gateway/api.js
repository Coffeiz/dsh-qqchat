const API_BASE = 'https://api.sgroup.qq.com';
const SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com';
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
function looksLikeMarkdown(text) {
    return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|\*\*|__|`|\[[^\]]+\]\([^\)]+\)/m.test(text);
}
export class QQApiClient {
    db;
    config;
    tokens = new Map();
    sequences = new Map();
    streamSequence = (Date.now() ^ Math.floor(Math.random() * 65_536)) & 0xffff;
    constructor(db, config) {
        this.db = db;
        this.config = config;
    }
    clearToken(accountId) { this.tokens.delete(Number(accountId)); }
    async token(account) {
        const id = Number(account.id);
        const cached = this.tokens.get(id);
        if (cached && cached.expiresAt > Date.now() + 60_000)
            return cached.token;
        const response = await fetch(TOKEN_URL, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ appId: account.app_id, clientSecret: account.app_secret }),
            signal: AbortSignal.timeout(15_000),
        });
        const data = await safeJson(response);
        if (!response.ok || !data?.access_token)
            throw new Error(`QQ access_token 获取失败: HTTP ${response.status}`);
        const ttl = Number(data.expires_in || 7200);
        this.tokens.set(id, { token: data.access_token, expiresAt: Date.now() + Math.max(60, ttl) * 1000 });
        return data.access_token;
    }
    async gatewayUrl(account, retry = true) {
        const token = await this.token(account);
        const base = account.sandbox ? SANDBOX_API_BASE : API_BASE;
        const response = await fetch(`${base}/gateway`, {
            headers: { Authorization: `QQBot ${token}` }, signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 401 && retry) {
            this.clearToken(account.id);
            return this.gatewayUrl(account, false);
        }
        const data = await safeJson(response);
        if (!response.ok || !data?.url)
            throw new Error(`QQ gateway 获取失败: HTTP ${response.status}`);
        return data.url;
    }
    nextSeq(messageId) {
        const key = messageId || `active:${Date.now()}:${Math.random()}`;
        const next = (this.sequences.get(key) || 0) + 1;
        this.sequences.set(key, next);
        return next;
    }
    /**
     * QQ stream_messages requires a fresh msg_seq for each stream session.
     * It is intentionally not scoped by the inbound message id: using 1 for
     * every reply causes QQ to reject later streams as duplicated messages.
     */
    nextStreamSeq() {
        this.streamSequence = (this.streamSequence + 1) & 0xffff;
        return this.streamSequence;
    }
    async request(account, method, path, body, retry = true) {
        const token = await this.token(account);
        const base = account.sandbox ? SANDBOX_API_BASE : API_BASE;
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `QQBot ${token}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
        });
        const data = await safeJson(response);
        if (response.status === 401 && retry) {
            this.clearToken(account.id);
            return this.request(account, method, path, body, false);
        }
        if (!response.ok) {
            const code = data?.code ? ` code=${String(data.code)}` : '';
            const message = data?.message ? ` ${String(data.message)}` : '';
            throw new Error(`QQ API HTTP ${response.status}${code}${message}`);
        }
        return (data || {});
    }
    async sendText(account, targetId, text, { group = false, messageId = null, format = this.config.replyFormat } = {}) {
        const path = group ? `/v2/groups/${encodeURIComponent(targetId)}/messages` : `/v2/users/${encodeURIComponent(targetId)}/messages`;
        const seq = this.nextSeq(messageId);
        const useMarkdown = format === 'markdown' || (format === 'smart' && looksLikeMarkdown(text));
        const makeBody = (markdown) => ({
            msg_type: markdown ? 2 : 0,
            ...(markdown ? { markdown: { content: text } } : { content: text }),
            msg_seq: seq,
            ...(messageId ? { msg_id: messageId } : {}),
        });
        try {
            return await this.request(account, 'POST', path, makeBody(useMarkdown));
        }
        catch (error) {
            if (useMarkdown && /50056|markdown|md perm/i.test(String(error))) {
                return this.request(account, 'POST', path, makeBody(false));
            }
            throw error;
        }
    }
    async sendReplyWithActiveFallback(account, targetId, text, options) {
        try {
            return await this.sendText(account, targetId, text, options);
        }
        catch (error) {
            if (!options.messageId)
                throw error;
            return this.sendText(account, targetId, text, { ...options, messageId: null });
        }
    }
    createPrivateTextStream(account, targetId, { messageId = null, format = this.config.replyFormat } = {}) {
        const path = `/v2/users/${encodeURIComponent(targetId)}/stream_messages`;
        const msgSeq = this.nextStreamSeq();
        const contentType = format === 'markdown' ? 'markdown' : 'text';
        let fullText = '';
        let streamMessageId;
        let index = 0;
        let sent = false;
        let timer;
        let chain = Promise.resolve();
        let finished = false;
        let lastSentText = '';
        const enqueue = (inputState, content) => {
            chain = chain.then(async () => {
                // Build the request only when the queued task runs. The first
                // response supplies stream_msg_id for all following frames.
                const body = {
                    input_mode: 'replace', input_state: inputState, index: index++, content_type: contentType,
                    content_raw: content, msg_seq: msgSeq,
                    ...(messageId ? { msg_id: messageId, event_id: messageId } : {}),
                    ...(streamMessageId ? { stream_msg_id: streamMessageId } : {}),
                };
                let attempt = 0;
                while (true) {
                    try {
                        const result = await this.request(account, 'POST', path, body);
                        sent = true;
                        if (!streamMessageId) {
                            const id = typeof result.stream_msg_id === 'string' ? result.stream_msg_id : result.id;
                            if (typeof id === 'string' && id)
                                streamMessageId = id;
                        }
                        lastSentText = content;
                        return;
                    }
                    catch (error) {
                        const message = String(error);
                        const rateLimited = /HTTP 429|50002|rate limit/i.test(message);
                        if (!rateLimited || attempt >= 3)
                            throw error;
                        const delay = 1000 * (2 ** attempt++);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            });
            return chain;
        };
        const flush = (inputState = 1) => {
            timer = undefined;
            if (!fullText && inputState !== 10)
                return chain;
            if (inputState !== 10 && fullText === lastSentText)
                return chain;
            return enqueue(inputState, fullText);
        };
        return {
            push: delta => {
                if (!delta || finished)
                    return;
                fullText += delta;
                if (!timer) {
                    timer = setTimeout(() => { void flush().catch(() => { }); }, 500);
                    timer.unref?.();
                }
            },
            finish: async (text) => {
                finished = true;
                if (timer)
                    clearTimeout(timer);
                timer = undefined;
                fullText = text;
                await flush(1);
                await chain;
                await flush(10);
                await chain;
            },
            hasSent: () => sent,
        };
    }
}
async function safeJson(response) {
    try {
        return await response.json();
    }
    catch {
        return undefined;
    }
}
export function isReplyFormat(value) {
    return value === 'smart' || value === 'markdown' || value === 'compat';
}
