import type { MappingResult } from './mappings';
import type { SparkSummary } from './SummaryTypes';

export const MERGED_SCHEMA = 'spark_merged.v1';

export interface MergedReport {
    schema: typeof MERGED_SCHEMA;
    summary: SparkSummary;
    metadata: any;
}

/**
 * Keep the Viewer summary and metadata as two separate top-level objects.
 * This avoids collisions between Summary fields (profile/health/sources) and
 * metadata fields. The mapping status is recorded inside the existing
 * summary.coverage.notes array, not as a new Summary field.
 */
export function mappingNote(mapping: MappingResult): string {
    if (mapping.status === 'ok') {
        return `Mappings: ${mapping.type} (online).`;
    }
    if (mapping.status === 'skipped') {
        return 'Mappings: skipped; some method names may be unresolved; AI analysis quality may be reduced.';
    }
    return `Mappings: ${mapping.status}; some method names may be unresolved.`;
}

export function buildMergedReport(
    summary: SparkSummary,
    metadata: any,
    mapping: MappingResult
): MergedReport {
    const notes = [...(summary.coverage.notes || [])];
    const note = mappingNote(mapping);
    if (note && !notes.includes(note)) notes.push(note);

    return {
        schema: MERGED_SCHEMA,
        summary: {
            ...summary,
            coverage: {
                ...summary.coverage,
                notes,
            },
        },
        metadata,
    };
}