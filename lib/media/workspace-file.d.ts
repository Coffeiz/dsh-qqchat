interface WorkspaceFile {
    root: string;
    path: string;
}
export declare function resolveWorkspaceFile(workspace: string, input: string): Promise<WorkspaceFile>;
export declare function openWorkspaceFile({ root, path }: WorkspaceFile): Promise<import("fs/promises").FileHandle>;
export {};
