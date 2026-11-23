export declare const QQ_FILE_MAX_BYTES: number;
type Post = (path: string, body: unknown, signal: AbortSignal) => Promise<Record<string, unknown>>;
export declare function uploadQQFile(post: Post, path: string, filename: string, data: Buffer, signal: AbortSignal, fileType?: 3 | 4): Promise<string>;
export {};
