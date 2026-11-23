import { execFile } from 'node:child_process';
import { encode, isSilk } from 'silk-wasm';
export const QQ_VOICE_MAX_BYTES = 20 * 1024 * 1024;
export async function prepareQQVoice(data, signal) {
    if (!data.length || data.length > QQ_VOICE_MAX_BYTES)
        throw new Error('语音文件大小必须在 1 字节到 20 MiB 之间');
    signal?.throwIfAborted();
    if (isSilk(data))
        return data;
    const sampleRate = 24_000;
    const pcm = await new Promise((resolve, reject) => {
        const child = execFile('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe',
            '-i', 'pipe:0', '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1',
        ], { encoding: 'buffer', maxBuffer: sampleRate * 2 * 300, timeout: 30_000, signal }, (error, stdout) => {
            if (error || !stdout.length) {
                reject(new Error(error?.code === 'ENOENT'
                    ? '转换非 SILK 语音需要在 DSH Host 安装 FFmpeg'
                    : '音频无法转换或超过 5 分钟，请选择较短的有效音频'));
            }
            else {
                resolve(stdout);
            }
        });
        child.stdin?.on('error', () => { });
        child.stdin?.end(data);
    });
    signal?.throwIfAborted();
    try {
        const result = await encode(pcm, sampleRate);
        if (!result.duration || !isSilk(result.data))
            throw new Error('语音编码无效');
        return Buffer.from(result.data);
    }
    catch {
        throw new Error('音频无法编码为 QQ SILK 语音');
    }
}
