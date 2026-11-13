import type {
    ExportSamplerData,
    ExportStackNode,
    ExportThreadNode,
    ExportWindowStatistics,
} from './ExportModel';
import type { MappingResult } from './mappings';

/**
 * Adapt the protobufjs-decoded SamplerData object to the neutral ExportModel
 * consumed by the vendored SummaryGenerator.
 *
 * Spark stores each thread's call tree in a flattened form:
 *   thread.children       = flat pool of StackTraceNode
 *   thread.childrenRefs   = indices of the root frames
 *   node.childrenRefs     = indices of that node's children
 *   node.times[]          = inclusive time per time window
 *
 * The viewer's Preprocessing.unflatten does the same reconstruction. We only
 * reproduce that part; the summary generator does not need NodeMap,
 * BottomUpMap or SourcesMap.
 */
export function adaptSamplerData(data: any, mapping?: MappingResult): ExportSamplerData {
    const classSources: Record<string, string> = data.classSources || {};
    const byId: Record<number, string> = {};
    let idOffset = 0;

    const threads: ExportThreadNode[] = (data.threads || []).map((thread: any, index: number) => {
        const pool: any[] = Array.isArray(thread.children) ? thread.children : [];
        const base = idOffset;
        idOffset += pool.length || 1;

        const built = new Map<number, ExportStackNode>();
        const visiting = new Set<number>();

        const build = (nodeIndex: number): ExportStackNode => {
            const cached = built.get(nodeIndex);
            if (cached) return cached;

            const source = pool[nodeIndex] || {};
            const id = base + nodeIndex;
            const mapped = mapping?.map
                ? mapping.map({
                      className: source.className || '',
                      methodName: source.methodName || '',
                      methodDesc: source.methodDesc,
                  })
                : undefined;

            const node: ExportStackNode = {
                id,
                className: source.className || '',
                methodName: source.methodName || '',
                resolvedClassName: mapped?.className || undefined,
                resolvedMethodName: mapped?.methodName || undefined,
                methodDesc: source.methodDesc || undefined,
                lineNumber: source.lineNumber || undefined,
                parentLineNumber: source.parentLineNumber || undefined,
                times: Array.isArray(source.times) ? source.times : [],
                children: [],
            };

            const sourceName = classSources[source.className];
            if (sourceName) byId[id] = sourceName;

            built.set(nodeIndex, node);

            // A well-formed spark tree is acyclic. Keep a guard so a corrupt
            // profile cannot freeze the page in an infinite recursion.
            if (visiting.has(nodeIndex)) return node;
            visiting.add(nodeIndex);
            node.children = (Array.isArray(source.childrenRefs) ? source.childrenRefs : [])
                .filter((ref: any) => Number.isInteger(ref) && ref >= 0 && ref < pool.length)
                .map((ref: number) => build(ref));
            visiting.delete(nodeIndex);

            return node;
        };

        const rootRefs: number[] = Array.isArray(thread.childrenRefs) && thread.childrenRefs.length
            ? thread.childrenRefs
            : pool.length
              ? [0]
              : [];
        const children = rootRefs
            .filter((ref: any) => Number.isInteger(ref) && ref >= 0 && ref < pool.length)
            .map((ref: number) => build(ref));

        return {
            id: index,
            name: thread.name || '(unnamed)',
            times: Array.isArray(thread.times) ? thread.times : [],
            children,
        };
    });

    const stats: Record<number, ExportWindowStatistics> = {};
    for (const [key, value] of Object.entries(data.timeWindowStatistics || {})) {
        stats[Number(key)] = value as ExportWindowStatistics;
    }

    return {
        metadata: data.metadata,
        threads,
        timeWindows: Array.isArray(data.timeWindows) ? data.timeWindows : [],
        timeWindowStatistics: stats,
        sources: {
            hasSources: Object.keys(classSources).length > 0,
            byId,
        },
    };
}