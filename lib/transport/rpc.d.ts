import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
import type { QQChatRuntime } from '../session/runtime.js';
type RpcSuccess<T> = {
    ok: true;
    value: T;
};
type RpcFailure = {
    ok: false;
    error: {
        code: 'internal';
        message: string;
        details: Record<string, never>;
    };
};
export type QQChatRpcResult<T = unknown> = RpcSuccess<T> | RpcFailure;
export type QQChatRpcHandler = ConnectionRpcHandler;
export declare function createQQChatRpc(runtime: QQChatRuntime): ConnectionRpcHandler;
export {};
