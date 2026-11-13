/**
 * Single protobuf root for the browser app.
 *
 * The schema is vendored from spark-viewer (GPL-3.0):
 * https://github.com/lucko/spark-viewer/tree/master/proto
 * The FastMirror fork carries the same schema plus export code.
 *
 * Field names are camelCase because this is the viewer schema, not the Java
 * schema. The output metadata therefore matches the official `?raw=1` JSON.
 */
import * as protobuf from 'protobufjs';
// esbuild loads this as text (see scripts/build.mjs); TypeScript has no
// built-in .proto module resolver, so the import is intentionally unchecked.
// @ts-ignore
import protoText from '../vendor/spark.proto';

export const root = protobuf.parse(protoText).root;
export const SamplerDataType = root.lookupType('spark.SamplerData');
export const SamplerMetadataType = root.lookupType('spark.SamplerMetadata');

export interface ToObjectOptions {
    longs?: unknown;
    enums?: unknown;
    defaults?: boolean;
    arrays?: boolean;
    objects?: boolean;
    bytes?: unknown;
}

export const METADATA_TO_OBJECT_OPTIONS: ToObjectOptions = {
    longs: Number,
    enums: Number,
    // Keep empty/default metadata fields so the merged metadata is structurally
    // comparable to the official `?raw=1` JSON (e.g. samplerMode: 0,
    // samplerEngineVersion: "", empty maps and empty strings).
    defaults: true,
    arrays: true,
    objects: true,
    bytes: String,
};

export const TO_OBJECT_OPTIONS: ToObjectOptions = {
    longs: Number,
    enums: Number,
    defaults: false,
    arrays: true,
    objects: true,
    bytes: String,
};

export function decodeMessage(typeName: string, bytes: Uint8Array): any {
    const type = root.lookupType(typeName);
    return type.toObject(type.decode(bytes), TO_OBJECT_OPTIONS as any);
}