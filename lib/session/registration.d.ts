import type { Session } from '@deepseek-ai/dsh-session';
import type { QQChatDisplayEvent } from '../types.js';
export interface SessionEventRegistrationOptions {
    readonly argv?: readonly string[];
    readonly dshHome?: string;
    readonly anchors?: readonly string[];
}
export declare function profileNameFromArgv(argv: readonly string[]): string | undefined;
/**
 * Resolve the Session package copies the host and persistence provider may use.
 * The writer is tried against the live Session; private-class identity makes
 * writers from unrelated copies reject before they can append anything.
 */
export declare function loadQQChatPluginRecordWriters(options?: SessionEventRegistrationOptions): Promise<number>;
export declare function appendQQChatPluginRecord(session: Session, event: QQChatDisplayEvent): boolean;
