import type { Context } from '@deepseek-ai/cordis';
import type { QQChatConfigInput } from './types.js';
export declare const name = "dsh-qqchat";
export declare const inject: readonly ["connection", "agents", "agentDefaultModel", "commands", "llm", "tools", "webServer", "workspaceRegistry", "sessionPersistence"];
export declare function apply(ctx: Context, inputConfig?: QQChatConfigInput): Promise<void>;
export type { QQChatConfig, QQChatConfigInput } from './types.js';
export { QQChatDatabase } from './storage/db.js';
export { normalizeQQDispatch } from './gateway/normalize.js';
declare const _default: {
    name: string;
    inject: readonly ["connection", "agents", "agentDefaultModel", "commands", "llm", "tools", "webServer", "workspaceRegistry", "sessionPersistence"];
    apply: typeof apply;
};
export default _default;
