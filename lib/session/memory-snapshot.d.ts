export declare const MEMORY_SNAPSHOT_TTL_MS: number;
export interface MemorySnapshotState {
    hash: string;
    lastInjectedAt: number;
    stale: boolean;
}
export interface MemorySnapshotEvent {
    type?: string;
    time?: number;
    data?: {
        source?: {
            kind?: string;
            plugin?: string;
            sections?: readonly {
                name?: string;
                text?: string;
            }[];
        };
        content?: readonly {
            type?: string;
            text?: string;
        }[];
    };
}
export declare function memorySnapshotHash(text: string): string;
export declare function shouldRefreshMemorySnapshot(previous: MemorySnapshotState | undefined, currentText: string, now: number, ttlMs?: number): boolean;
export declare function restoreMemorySnapshotState(events: readonly MemorySnapshotEvent[], sourcePlugin: string): MemorySnapshotState | undefined;
