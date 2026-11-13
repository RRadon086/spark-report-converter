import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
    adaptSamplerData,
    assertSupportedFileName,
    buildMergedReport,
    decodeSamplerFile,
    downloadFileName,
    generateSparkSummary,
    loadMappings,
    MERGED_SCHEMA,
    root as protobufRoot,
    UserFacingError,
} from './.build/library.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const samples = process.env.SPARK_SAMPLES_DIR
    ? path.resolve(process.env.SPARK_SAMPLES_DIR)
    : path.join(repoRoot, 'spark');

function bytesOf(fileName) {
    return readFileSync(path.join(samples, fileName));
}

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function decode(buffer) {
    return decodeSamplerFile(toArrayBuffer(buffer));
}

async function buildSample(fileName) {
    const decoded = decode(bytesOf(fileName));
    const mapping = await loadMappings(decoded.data.metadata, { skip: true });
    const summary = generateSparkSummary(adaptSamplerData(decoded.data, mapping));
    const merged = buildMergedReport(summary, decoded.data.metadata, mapping);
    return { decoded, mapping, summary, merged };
}

let passed = 0;
const failures = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`ok   ${name}`);
    } catch (error) {
        failures.push({ name, error });
        console.error(`FAIL ${name}`);
        console.error(error);
    }
}

const fVi = await buildSample('fViOWNasPc.sparkprofile');
const server = await buildSample('FZC9FG8ISN.sparkprofile');

await test('fVi raw: sampler/metadata/statistics', () => {
    const { decoded, summary } = fVi;
    assert.equal(decoded.compressed, false);
    assert.equal(decoded.originalBytes, 3_057_616);
    assert.equal(Object.keys(decoded.data.metadata).length, 18);
    assert.equal(decoded.data.metadata.platform.name, 'Forge');
    assert.equal(decoded.data.metadata.platform.version, '47.4.0');
    assert.equal(decoded.data.metadata.platform.minecraftVersion, '1.20.1');
    assert.equal(decoded.data.metadata.platform.sparkVersion, 2);
    assert.equal(decoded.data.metadata.sources.spark.version, '1.10.53');
    assert.equal(Object.keys(decoded.data.metadata.sources).length, 460);
    assert.equal(decoded.data.metadata.dataAggregator.type, 1);
    assert.equal(decoded.data.metadata.dataAggregator.tickLengthThreshold, 75_000);
    assert.equal(decoded.data.metadata.dataAggregator.numberOfIncludedTicks, 219);
    assert.equal(decoded.data.metadata.platformStatistics.world.totalEntities, 593);
    assert.equal(summary.coverage.threads, 1);
    assert.equal(summary.coverage.stackNodes, 20_304);
    assert.equal(summary.coverage.windows, 2);
    assert.match(summary.topMethods[0].method, /Unsafe\.park/);
});

await test('server raw: sampler/metadata/statistics', () => {
    const { decoded, summary } = server;
    assert.equal(decoded.compressed, false);
    assert.equal(decoded.originalBytes, 20_317_978);
    assert.equal(Object.keys(decoded.data.metadata).length, 18);
    assert.equal(decoded.data.metadata.platform.version, '47.4.16');
    assert.equal(Object.keys(decoded.data.metadata.sources).length, 305);
    assert.equal(decoded.data.metadata.dataAggregator.type, 0);
    assert.equal(decoded.data.metadata.platformStatistics.world.totalEntities, 2683);
    assert.ok(decoded.data.metadata.serverConfigurations['server.properties']);
    assert.equal(summary.coverage.threads, 1);
    assert.equal(summary.coverage.stackNodes, 115_559);
    assert.equal(summary.coverage.windows, 6);
});

await test('merge contract: separate summary/metadata, no field collision', () => {
    const { merged, summary, decoded } = fVi;
    assert.equal(merged.schema, MERGED_SCHEMA);
    assert.equal(merged.summary.schema, 'spark_summary.v1');
    assert.equal(merged.metadata, decoded.data.metadata);
    assert.deepEqual(Object.keys(merged).sort(), ['metadata', 'schema', 'summary']);
    assert.equal(Object.keys(merged.metadata).length, 18);
    assert.equal(merged.metadata.dataAggregator.tickLengthThreshold, 75_000);
    assert.equal(merged.metadata.platformStatistics.world.totalEntities, 593);
    assert.ok(merged.summary.coverage.notes.some(note => note.includes('Mappings: skipped')));
    assert.equal(summary.coverage.notes.length, 2, 'merge must not mutate the source summary');
});

await test('output sizes stay in the task-02 range', () => {
    const fviBytes = Buffer.byteLength(JSON.stringify(fVi.merged));
    const serverBytes = Buffer.byteLength(JSON.stringify(server.merged));
    assert.ok(fviBytes > 160_000 && fviBytes < 175_000, `fVi bytes: ${fviBytes}`);
    assert.ok(serverBytes > 195_000 && serverBytes < 210_000, `server bytes: ${serverBytes}`);
});

await test('gzip input: both samples decode/decompress', async () => {
    for (const [name, expectedNodes] of [
        ['fViOWNasPc.sparkprofile', 20_304],
        ['FZC9FG8ISN.sparkprofile', 115_559],
    ]) {
        const gz = gzipSync(bytesOf(name));
        const decoded = decode(gz);
        assert.equal(decoded.compressed, true);
        assert.equal(decoded.originalBytes, gz.length);
        assert.equal(decoded.data.metadata.platform.name, 'Forge');
        const summary = generateSparkSummary(adaptSamplerData(decoded.data));
        assert.equal(summary.coverage.stackNodes, expectedNodes);
    }
});

await test('empty/random/corrupt-gzip inputs fail with UserFacingError', () => {
    assert.throws(() => decodeSamplerFile(new ArrayBuffer(0)), UserFacingError);
    assert.throws(() => decode(Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) & 255))), UserFacingError);
    assert.throws(
        () => decode(Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.from('not a gzip stream')])),
        error => error instanceof UserFacingError && error.message.includes('gzip')
    );
});

await test('content-level non-sampler / missing threads fail', () => {
    const SamplerData = protobufRoot.lookupType('spark.SamplerData');
    const HealthData = protobufRoot.lookupType('spark.HealthData');
    const platform = { name: 'Forge', version: '47.4.0', minecraftVersion: '1.20.1', sparkVersion: 2 };

    const noThreads = Buffer.from(SamplerData.encode(SamplerData.create({ metadata: { platform } })).finish());
    assert.throws(
        () => decode(noThreads),
        error => error instanceof UserFacingError && error.message.includes('线程数据')
    );

    const health = Buffer.from(HealthData.encode(HealthData.create({ metadata: { platform } })).finish());
    assert.throws(() => decode(health), UserFacingError);
});

await test('file extension guards', () => {
    assert.throws(() => assertSupportedFileName('x.sparkheap'), /sparkheap/);
    assert.throws(() => assertSupportedFileName('x.sparkhealth'), /sparkhealth/);
    assert.throws(() => assertSupportedFileName('x.txt'), /\.sparkprofile/);
    assert.doesNotThrow(() => assertSupportedFileName('x.sparkprofile'));
    assert.doesNotThrow(() => assertSupportedFileName('x.SPARKPROFILE'));
});

await test('download filename sanitization', () => {
    assert.equal(downloadFileName('abc.sparkprofile'), 'abc.spark-merged.json');
    assert.equal(downloadFileName('A.SPARKPROFILE'), 'A.spark-merged.json');
    assert.equal(downloadFileName('a:b?.sparkprofile'), 'a_b_.spark-merged.json');
    assert.equal(downloadFileName(''), 'spark-report.spark-merged.json');
});

await test('skip mapping is non-fatal', async () => {
    const mapping = await loadMappings(fVi.decoded.data.metadata, { skip: true });
    assert.equal(mapping.status, 'skipped');
    assert.equal(mapping.map, undefined);
    assert.match(mapping.message, /跳过/);
});

if (failures.length) {
    console.error(`\n${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
} else {
    console.log(`\nAll ${passed} logic tests passed.`);
}