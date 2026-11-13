import { formatError } from './errors';
import { decodeMessage } from './proto';

/**
 * Spark's official mappings service, as used by spark-viewer:
 *   https://spark-mappings.lucko.me/dist/mappings.json
 *   https://spark-mappings.lucko.me/dist/<version>/<type>.wasm
 *
 * The `.wasm` files are actually protobuf messages (viewer schema), not
 * WebAssembly. The official viewer fetches them with `fetch()` and decodes
 * `spark.McpMappings`, `spark.YarnMappings`, etc.
 *
 * No mappings data is bundled. If the request fails, conversion continues
 * with the original names and the UI/output records a warning.
 */
const MAPPINGS_BASE = 'https://spark-mappings.lucko.me/dist/';
const MAPPINGS_JSON = MAPPINGS_BASE + 'mappings.json';
const REQUEST_TIMEOUT_MS = 8000;

export type MappingStatus = 'ok' | 'failed' | 'skipped' | 'unsupported' | 'unavailable';

export interface MappingNode {
    className: string;
    methodName: string;
    methodDesc?: string;
}

export interface MappedNames {
    className?: string;
    methodName?: string;
}

export interface MappingResult {
    status: MappingStatus;
    type?: string;
    message: string;
    detail?: string;
    map?: (node: MappingNode) => MappedNames;
}

interface MappingsMetadata {
    auto?: Record<string, string | null>;
    types?: Record<string, unknown>;
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, {
            signal: controller.signal,
            mode: 'cors',
            cache: 'no-cache',
        });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

function splitLambda(className: string): { base: string; suffix: string } {
    const match = className.match(/^(.+)(\$\$Lambda.+)$/);
    return match ? { base: match[1], suffix: match[2] } : { base: className, suffix: '' };
}

function makeMcpMapper(data: any): (node: MappingNode) => MappedNames {
    const methods: Record<string, string> = data.methods || {};
    return node => {
        const methodName = methods[node.methodName];
        return methodName ? { methodName } : {};
    };
}

function makeYarnMapper(data: any): (node: MappingNode) => MappedNames {
    const classes: Record<string, string> = data.classes || {};
    const methods: Record<string, string> = data.methods || {};
    return node => {
        const { base, suffix } = splitLambda(node.className);
        const className = classes[base];
        const methodName = methods[node.methodName];
        return {
            className: className ? className + suffix : undefined,
            methodName: methodName || undefined,
        };
    };
}

function makeVanillaMapper(data: any): (node: MappingNode) => MappedNames {
    const classes: Record<string, any> = data.classes || {};
    return node => {
        const { base, suffix } = splitLambda(node.className);
        const clazz = classes[base];
        if (!clazz) return {};

        let methodName: string | undefined;
        const candidates = (clazz.methods || []).filter(
            (method: any) => method.obfuscated === node.methodName
        );
        if (candidates.length === 1) {
            methodName = candidates[0].mapped;
        } else if (candidates.length > 1) {
            const exact = candidates.find(
                (method: any) => method.description === node.methodDesc
            );
            if (exact) methodName = exact.mapped;
        }

        return {
            className: clazz.mapped ? clazz.mapped + suffix : undefined,
            methodName,
        };
    };
}

/**
 * Detect and load mappings using the same `auto` lookup as spark-viewer:
 * forge/1.20.1 -> mcp-1_20, fabric/1.20.1 -> yarn-1_20, paper -> bukkit.
 */
export async function loadMappings(
    metadata: any,
    options: { skip?: boolean } = {}
): Promise<MappingResult> {
    if (options.skip) {
        return {
            status: 'skipped',
            message: '已主动跳过联网映射。',
        };
    }

    let mappingsMetadata: MappingsMetadata;
    try {
        mappingsMetadata = await fetchJson<MappingsMetadata>(MAPPINGS_JSON);
    } catch (error) {
        return {
            status: 'failed',
            message: '无法获取映射元数据。',
            detail: formatError(error),
        };
    }

    const platform = metadata?.platform || {};
    const mcVersion = String(platform.minecraftVersion || '');
    let platformName = String(platform.name || '').toLowerCase();
    if (platformName === 'paper') platformName = 'bukkit';
    if (platform.type === 3 || platform.type === 'APPLICATION') platformName = 'vanilla';

    const key = `${platformName}/${mcVersion}`;
    const type = mappingsMetadata.auto?.[key];
    if (!type) {
        return {
            status: 'unavailable',
            message: `映射服务没有 ${key} 的自动映射。`,
        };
    }

    if (type.startsWith('bukkit')) {
        return {
            status: 'unsupported',
            type,
            message: `映射类型 ${type} 需要 Bukkit/MCP 组合解析，当前版本未实现。`,
        };
    }

    const prefixes: Array<[string, string, string]> = [
        ['mcp-', 'mcp', 'spark.McpMappings'],
        ['yarn-', 'yarn', 'spark.YarnMappings'],
        ['vanilla-', 'mojang', 'spark.MojangMappings'],
    ];
    const entry = prefixes.find(([prefix]) => type.startsWith(prefix));
    if (!entry) {
        return {
            status: 'unsupported',
            type,
            message: `未知映射类型 ${type}。`,
        };
    }

    const [prefix, kind, messageType] = entry;
    const version = type.slice(prefix.length);
    const url = `${MAPPINGS_BASE}${version}/${kind}.wasm`;
    try {
        const bytes = await fetchBytes(url);
        const data = decodeMessage(messageType, bytes);
        let map: (node: MappingNode) => MappedNames;
        if (kind === 'mcp') {
            map = makeMcpMapper(data);
        } else if (kind === 'yarn') {
            map = makeYarnMapper(data);
        } else {
            map = makeVanillaMapper(data);
        }
        return {
            status: 'ok',
            type,
            message: '已应用联网方法名映射。',
            map,
        };
    } catch (error) {
        return {
            status: 'failed',
            type,
            message: '无法下载或解析方法名映射。',
            detail: formatError(error),
        };
    }
}