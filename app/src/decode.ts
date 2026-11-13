import { inflate } from 'pako';
import { UserFacingError, formatError } from './errors';
import {
    METADATA_TO_OBJECT_OPTIONS,
    SamplerDataType,
    SamplerMetadataType,
    TO_OBJECT_OPTIONS,
} from './proto';

export interface DecodedSampler {
    data: any;
    originalBytes: number;
    decodedBytes: number;
    compressed: boolean;
}

/**
 * Reject obvious non-sampler files before reading the body. Content-level
 * validation still happens in decodeSamplerFile, so renaming a heap/health
 * file to .sparkprofile cannot silently succeed.
 */
export function assertSupportedFileName(name: string): void {
    if (/\.sparkheap$/i.test(name)) {
        throw new UserFacingError(
            '暂不支持 .sparkheap（堆内存）报告。本工具只转换 sampler 类 .sparkprofile。'
        );
    }
    if (/\.sparkhealth$/i.test(name)) {
        throw new UserFacingError(
            '暂不支持 .sparkhealth（健康报告）。本工具只转换 sampler 类 .sparkprofile。'
        );
    }
    if (!/\.sparkprofile$/i.test(name)) {
        throw new UserFacingError(
            '请选择扩展名为 .sparkprofile 的 Spark sampler 报告。'
        );
    }
}

/**
 * Decode a .sparkprofile ArrayBuffer.
 *
 * The viewer downloads raw protobuf bytes; bytebin or manually created copies
 * can be gzip-compressed. Both are accepted, detected by content (gzip magic),
 * not by filename.
 */
export function decodeSamplerFile(buffer: ArrayBuffer): DecodedSampler {
    const original = new Uint8Array(buffer);
    if (original.byteLength === 0) {
        throw new UserFacingError(
            '文件为空（0 字节）。请选择有效的 .sparkprofile 文件。'
        );
    }

    let bytes = original;
    let compressed = false;
    if (original.byteLength >= 2 && original[0] === 0x1f && original[1] === 0x8b) {
        compressed = true;
        try {
            bytes = inflate(original);
        } catch (error) {
            throw new UserFacingError(
                'gzip 解压失败，文件可能已损坏。',
                formatError(error)
            );
        }
    }

    let data: any;
    try {
        const message: any = SamplerDataType.decode(bytes);
        if (!message.metadata) {
            throw new Error('SamplerData.metadata is empty');
        }
        // Decode metadata separately with defaults enabled so zero/empty
        // fields survive, matching the official raw=1 JSON more closely.
        const metadata = SamplerMetadataType.toObject(
            message.metadata,
            METADATA_TO_OBJECT_OPTIONS as any
        );
        data = SamplerDataType.toObject(message, TO_OBJECT_OPTIONS as any);
        data.metadata = metadata;
    } catch (error) {
        throw new UserFacingError(
            '无法解析为 Spark protobuf。文件可能已损坏，或不是 sampler 报告。',
            formatError(error)
        );
    }

    if (!data || !data.metadata) {
        throw new UserFacingError(
            '解析成功但没有找到 metadata，可能不是 Spark 报告。',
            `decoded top-level keys: ${data ? Object.keys(data).join(', ') : '(none)'}`
        );
    }
    if (!Array.isArray(data.threads) || data.threads.length === 0) {
        throw new UserFacingError(
            '没有找到 sampler 线程数据。该文件可能是 heap/health 报告，或不是 sampler 类型的 .sparkprofile。',
            `metadata keys: ${Object.keys(data.metadata).join(', ')}\nthreads: ${JSON.stringify(data.threads ?? null)}`
        );
    }

    return {
        data,
        originalBytes: original.byteLength,
        decodedBytes: bytes.byteLength,
        compressed,
    };
}