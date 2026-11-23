import { createHash } from 'node:crypto';
export const QQ_FILE_MAX_BYTES = 30 * 1024 * 1024;
function md5(data) {
    return createHash('md5').update(data).digest('hex');
}
function uploadUrl(value) {
    const url = typeof value === 'string' ? URL.parse(value) : null;
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port
        || !(url.hostname === 'myqcloud.com' || url.hostname.endsWith('.myqcloud.com'))) {
        throw new Error('QQ 分片存储地址无效');
    }
    return url;
}
export async function uploadQQFile(post, path, filename, data, signal) {
    const prepared = await post(`${path}/upload_prepare`, {
        file_type: 4, file_name: filename, file_size: data.length, md5: md5(data),
        sha1: createHash('sha1').update(data).digest('hex'), md5_10m: md5(data.subarray(0, 10_002_432)),
    }, signal);
    const { upload_id: uploadId, parts } = prepared;
    const blockSize = Number(prepared.block_size);
    if (typeof uploadId !== 'string' || !uploadId || !Number.isSafeInteger(blockSize) || blockSize <= 0
        || !Array.isArray(parts) || parts.length !== Math.ceil(data.length / blockSize)) {
        throw new Error('QQ 分块上传初始化响应无效');
    }
    const urls = new Map();
    for (const part of parts) {
        const index = part?.index;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > parts.length || urls.has(index)) {
            throw new Error('QQ 分片序号无效');
        }
        urls.set(index, uploadUrl(part.presigned_url));
    }
    for (const [index, url] of urls) {
        const offset = (index - 1) * blockSize;
        const chunk = data.subarray(offset, offset + blockSize);
        const response = await fetch(url, { method: 'PUT', body: new Uint8Array(chunk), redirect: 'error', signal });
        await response.body?.cancel();
        if (!response.ok)
            throw new Error(`QQ 分片存储返回 HTTP ${response.status}`);
        await post(`${path}/upload_part_finish`, {
            upload_id: uploadId, part_index: index, block_size: chunk.length, md5: md5(chunk),
        }, signal);
    }
    const result = await post(`${path}/files`, { upload_id: uploadId }, signal);
    if (typeof result.file_info !== 'string' || !result.file_info)
        throw new Error('QQ 上传响应缺少文件凭据');
    return result.file_info;
}
