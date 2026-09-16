export interface SessionEventRegistrationOptions {
    readonly argv?: readonly string[];
    readonly dshHome?: string;
    readonly anchors?: readonly string[];
}
export declare function profileNameFromArgv(argv: readonly string[]): string | undefined;
/**
 * Register the plugin's log-only event in every reachable dsh-session copy.
 *
 * DSH does not expose a public downstream event registration API yet. This
 * small compatibility shim follows the ecosystem convention used by other
 * DSH plugins and is intentionally idempotent and best-effort.
 */
export declare function registerQQChatSessionEventType(options?: SessionEventRegistrationOptions): Promise<number>;
