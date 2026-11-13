import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { root as protobufRoot } from './.build/library.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const pagePath = process.env.SPARK_PAGE_PATH
    ? path.resolve(process.env.SPARK_PAGE_PATH)
    : path.join(repoRoot, 'release', 'spark-report-converter', 'index.html');
const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseZip = process.env.SPARK_RELEASE_ZIP
    ? path.resolve(process.env.SPARK_RELEASE_ZIP)
    : path.join(repoRoot, 'release', `spark-report-converter-v${pkg.version}.zip`);
const samples = process.env.SPARK_SAMPLES_DIR
    ? path.resolve(process.env.SPARK_SAMPLES_DIR)
    : path.join(repoRoot, 'spark');
const work = path.join(here, '.build', 'browser');
const fixtures = path.join(work, 'fixtures');
const downloads = path.join(work, 'downloads');
const edgePath = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

if (!existsSync(pagePath)) {
    throw new Error(`Release page not found: ${pagePath}\nRun: npm run release`);
}
if (!existsSync(path.join(samples, 'fViOWNasPc.sparkprofile'))) {
    throw new Error(`Sample not found under ${samples}`);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(fixtures, { recursive: true });
mkdirSync(downloads, { recursive: true });

function writeFixture(name, buffer) {
    writeFileSync(path.join(fixtures, name), buffer);
    return path.join(fixtures, name);
}

const emptyPath = writeFixture('empty.sparkprofile', Buffer.alloc(0));
const randomPath = writeFixture('random.sparkprofile', Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) & 255)));
const corruptGzipPath = writeFixture('corrupt-gzip.sparkprofile', Buffer.concat([
    Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
    Buffer.from('not a gzip stream'),
]));
const fakeHeapPath = writeFixture('fake.sparkheap', Buffer.from([0x0a, 0x02, 0x08, 0x01]));
const fakeHealthPath = writeFixture('fake.sparkhealth', Buffer.from([0x0a, 0x02, 0x08, 0x01]));

const SamplerData = protobufRoot.lookupType('spark.SamplerData');
const HealthData = protobufRoot.lookupType('spark.HealthData');
const platform = { name: 'Forge', version: '47.4.0', minecraftVersion: '1.20.1', sparkVersion: 2 };
const noThreadsPath = writeFixture(
    'no-threads.sparkprofile',
    Buffer.from(SamplerData.encode(SamplerData.create({ metadata: { platform } })).finish())
);
const healthAsProfilePath = writeFixture(
    'health-as.sparkprofile',
    Buffer.from(HealthData.encode(HealthData.create({ metadata: { platform } })).finish())
);

const fViPath = path.join(samples, 'fViOWNasPc.sparkprofile');
const serverPath = path.join(samples, 'FZC9FG8ISN.sparkprofile');
const fViGzipPath = writeFixture('fVi-gzip.sparkprofile', gzipSync(readFileSync(fViPath)));
const serverGzipPath = writeFixture('server-gzip.sparkprofile', gzipSync(readFileSync(serverPath)));

// Deterministic mapping fixture: exercises the real mapping code path without
// depending on the external mapping service being reachable from CI.
const McpMappings = protobufRoot.lookupType('spark.McpMappings');
const mappingMetadataBody = JSON.stringify({
    auto: { 'forge/1.20.1': 'mcp-1_20' },
});
const mappingDataBody = Buffer.from(
    McpMappings.encode(McpMappings.create({ methods: { m_63085_: 'get' } })).finish()
);

const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: process.env.HEADED ? false : true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,1000'],
    defaultViewport: { width: 1280, height: 1000 },
});

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

async function openPage(url = pathToFileURL(pagePath).href, options = {}) {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    if (options.stubMapping) {
        await page.setRequestInterception(true);
        page.on('request', request => {
            const requestUrl = request.url();
            if (requestUrl.endsWith('/dist/mappings.json')) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: mappingMetadataBody,
                });
            } else if (requestUrl.includes('/dist/1_20/mcp.wasm')) {
                if (options.abortMappingData) request.abort();
                else request.respond({
                    status: 200,
                    contentType: 'application/wasm',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: mappingDataBody,
                });
            } else {
                request.continue();
            }
        });
    }
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#dropzone');
    return { page, pageErrors, consoleErrors };
}

async function convert(page, filePath, options = {}) {
    const { skipMappings = false, offline = false } = options;
    await page.evaluate(skip => {
        document.getElementById('skip-mappings').checked = skip;
    }, skipMappings);
    if (offline) await page.setOfflineMode(true);
    const input = await page.$('#file-input');
    await input.uploadFile(filePath);
    await page.waitForFunction(() => {
        const status = document.getElementById('status');
        return status && (
            status.textContent.includes('转换完成') ||
            status.textContent.includes('转换未完成') ||
            status.classList.contains('error')
        );
    }, { timeout: 45_000 });
    const result = await readResult(page);
    if (offline) await page.setOfflineMode(false);
    return result;
}

async function readResult(page) {
    return page.evaluate(async () => {
        const download = document.getElementById('download');
        const result = document.getElementById('result');
        const errorDetails = document.getElementById('error-details');
        const gate = document.getElementById('mapping-gate');
        const quality = document.getElementById('mapping-quality');
        let parsed = null;
        let href = download?.getAttribute('href') || '';
        if (href.startsWith('blob:')) {
            try {
                parsed = JSON.parse(await (await fetch(href)).text());
            } catch {
                parsed = null;
            }
        }
        const summary = parsed?.summary;
        const metadata = parsed?.metadata;
        return {
            status: document.getElementById('status')?.textContent || '',
            statusClass: document.getElementById('status')?.className || '',
            resultHidden: result ? result.hidden : true,
            downloadHidden: download ? download.hidden : true,
            downloadName: download?.download || '',
            href,
            sizes: document.getElementById('sizes')?.textContent || '',
            mapping: document.getElementById('mapping-status')?.textContent || '',
            gateVisible: gate ? !gate.hidden : false,
            gateText: gate?.textContent || '',
            gateDetail: document.getElementById('gate-detail')?.textContent || '',
            qualityVisible: quality ? !quality.hidden : false,
            qualityText: quality?.textContent || '',
            errorVisible: errorDetails ? !errorDetails.hidden : false,
            errorDetail: document.getElementById('error-detail')?.textContent || '',
            parsed: parsed ? {
                schema: parsed.schema,
                summarySchema: summary?.schema,
                metadataKeys: Object.keys(metadata || {}),
                stackNodes: summary?.coverage?.stackNodes,
                windows: summary?.coverage?.windows,
                threads: summary?.coverage?.threads,
                topMethods: (summary?.topMethods || []).slice(0, 10).map(m => m.method),
                dataAggregator: metadata?.dataAggregator,
                worldTotal: metadata?.platformStatistics?.world?.totalEntities,
                sourcesCount: Object.keys(metadata?.sources || {}).length,
                serverConfigKeys: Object.keys(metadata?.serverConfigurations || {}),
                platform: metadata?.platform,
                sparkRelease: metadata?.sources?.spark?.version,
                jsonBytes: new Blob([JSON.stringify(parsed)]).size,
            } : null,
        };
    });
}

async function downloadFile(page, expectedName) {
    await page.click('#download');
    const end = Date.now() + 8000;
    while (Date.now() < end) {
        const names = readdirSync(downloads);
        const hit = names.find(name => name === expectedName);
        if (hit) {
            const full = path.join(downloads, hit);
            if (statSync(full).size > 0) return { name: hit, size: statSync(full).size };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

await test('fVi raw + online mapping: output and actual download', async () => {
    const { page, pageErrors } = await openPage(undefined, { stubMapping: true });
    const result = await convert(page, fViPath);
    assert.ok(result.status.includes('转换完成'), result.status);
    assert.ok(result.parsed, 'no parsed JSON');
    assert.equal(result.parsed.schema, 'spark_merged.v1');
    assert.equal(result.parsed.summarySchema, 'spark_summary.v1');
    assert.equal(result.parsed.metadataKeys.length, 18);
    assert.equal(result.parsed.stackNodes, 20_304);
    assert.equal(result.parsed.windows, 2);
    assert.equal(result.parsed.dataAggregator.tickLengthThreshold, 75_000);
    assert.equal(result.parsed.dataAggregator.numberOfIncludedTicks, 219);
    assert.equal(result.parsed.worldTotal, 593);
    assert.equal(result.parsed.sourcesCount, 460);
    assert.equal(result.parsed.platform.version, '47.4.0');
    assert.equal(result.parsed.sparkRelease, '1.10.53');
    assert.ok(result.parsed.topMethods.some(method => method.includes('Unsafe.park')));
    assert.match(result.mapping, /映射/);
    const bodyText = await page.evaluate(() => document.body.textContent || '');
    assert.equal(bodyText.includes('MVP'), false, 'visible MVP badge remains');
    assert.equal(bodyText.includes('本地 HTML 版'), false, 'experimental title remains');
    assert.match(bodyText, /v1\.0\.0/);
    assert.equal(await page.evaluate(() => {
        const element = document.getElementById('ai-warning');
        return !!element && !element.hidden && getComputedStyle(element).display !== 'none';
    }), true, 'AI warning is not visible');
    assert.match(await page.$eval('#ai-warning', element => element.textContent || ''), /备份/);
    const file = await downloadFile(page, 'fViOWNasPc.spark-merged.json');
    assert.ok(file, 'download did not appear');
    assert.equal(file.size, result.parsed.jsonBytes);
    assert.deepEqual(pageErrors, []);
    await page.close();
});

await test('server raw + online mapping: output and actual download', async () => {
    const { page, pageErrors } = await openPage(undefined, { stubMapping: true });
    const result = await convert(page, serverPath);
    assert.ok(result.status.includes('转换完成'), result.status);
    assert.ok(result.parsed, 'no parsed JSON');
    assert.equal(result.parsed.metadataKeys.length, 18);
    assert.equal(result.parsed.stackNodes, 115_559);
    assert.equal(result.parsed.windows, 6);
    assert.equal(result.parsed.dataAggregator.type, 0);
    assert.equal(result.parsed.worldTotal, 2683);
    assert.equal(result.parsed.sourcesCount, 305);
    assert.deepEqual(result.parsed.serverConfigKeys, ['server.properties']);
    assert.equal(result.parsed.platform.version, '47.4.16');
    assert.ok(result.parsed.topMethods[0].includes('PalettedContainer.get'), result.parsed.topMethods[0]);
    const file = await downloadFile(page, 'FZC9FG8ISN.spark-merged.json');
    assert.ok(file, 'download did not appear');
    assert.equal(file.size, result.parsed.jsonBytes);
    assert.deepEqual(pageErrors, []);
    await page.close();
});

await test('both gzip inputs convert with identical key stats', async () => {
    const { page, pageErrors } = await openPage();
    const fvi = await convert(page, fViGzipPath, { skipMappings: true });
    assert.ok(fvi.parsed, 'gzip fVi failed');
    assert.equal(fvi.parsed.stackNodes, 20_304);
    const server = await convert(page, serverGzipPath, { skipMappings: true });
    assert.ok(server.parsed, 'gzip server failed');
    assert.equal(server.parsed.stackNodes, 115_559);
    assert.equal(server.parsed.worldTotal, 2683);
    assert.deepEqual(pageErrors, []);
    await page.close();
});

await test('skip mappings keeps raw method names and shows quality warning', async () => {
    const { page } = await openPage();
    const result = await convert(page, fViPath, { skipMappings: true });
    assert.ok(result.status.includes('转换完成'));
    assert.match(result.status, /质量可能下降/);
    assert.ok(result.mapping.includes('跳过'), result.mapping);
    assert.equal(result.qualityVisible, true);
    assert.match(result.qualityText, /AI 分析质量可能下降/);
    assert.ok(result.parsed.topMethods.some(method => method.includes('m_63085_')), result.parsed.topMethods);
    await page.close();
});

await test('default mapping metadata failure pauses and blocks output', async () => {
    const { page, pageErrors } = await openPage();
    const blocked = await convert(page, fViPath, { offline: true });
    assert.match(blocked.status, /转换未完成/);
    assert.equal(blocked.gateVisible, true, 'mapping gate is not visible');
    assert.match(blocked.gateText, /无法获取方法名映射/);
    assert.ok(blocked.gateDetail.length > 0, 'missing mapping technical detail');
    assert.equal(blocked.resultHidden, true);
    assert.equal(blocked.downloadHidden, true);
    assert.equal(blocked.parsed, null);

    const skipped = await convert(page, fViPath, { skipMappings: true });
    assert.ok(skipped.status.includes('转换完成'));
    assert.equal(skipped.qualityVisible, true);
    assert.ok(skipped.parsed, 'skip-after-block output missing');
    assert.deepEqual(pageErrors, []);
    await page.close();
});

await test('default mapping data failure pauses and blocks output', async () => {
    const { page: page2, pageErrors: page2Errors } = await openPage(undefined, {
        stubMapping: true,
        abortMappingData: true,
    });
    const blocked = await convert(page2, fViPath);
    assert.match(blocked.status, /转换未完成/);
    assert.equal(blocked.gateVisible, true);
    assert.match(blocked.gateText, /无法获取方法名映射/);
    assert.ok(blocked.gateDetail.length > 0);
    assert.equal(blocked.resultHidden, true);
    assert.equal(blocked.downloadHidden, true);
    assert.equal(blocked.parsed, null);
    assert.deepEqual(page2Errors, []);
    await page2.close();
});

await test('empty/random/corrupt/non-sampler inputs never produce a result', async () => {
    for (const file of [
        emptyPath,
        randomPath,
        corruptGzipPath,
        fakeHeapPath,
        fakeHealthPath,
        noThreadsPath,
        healthAsProfilePath,
    ]) {
        const { page, pageErrors } = await openPage();
        const result = await convert(page, file);
        assert.equal(result.statusClass.includes('error'), true, `${path.basename(file)}: ${result.status}`);
        assert.equal(result.resultHidden, true);
        assert.equal(result.downloadHidden, true);
        assert.equal(result.parsed, null);
        assert.ok(result.errorDetail.length > 0, 'missing technical detail');
        assert.deepEqual(pageErrors, []);
        await page.close();
    }
});

await test('new conversion invalidates the previous download', async () => {
    const { page } = await openPage();
    const first = await convert(page, fViPath, { skipMappings: true });
    assert.ok(first.href.startsWith('blob:'));
    const oldHref = first.href;

    const failed = await convert(page, fViPath, { offline: true });
    assert.equal(failed.gateVisible, true);
    assert.equal(failed.resultHidden, true);
    assert.equal(failed.downloadHidden, true);
    assert.equal(failed.href.startsWith('blob:'), false);
    assert.equal(await page.evaluate(async href => {
        try { await fetch(href); return 'still-fetchable'; } catch { return 'revoked'; }
    }, oldHref), 'revoked');

    const second = await convert(page, serverPath, { skipMappings: true });
    assert.ok(second.href.startsWith('blob:'));
    assert.equal(second.downloadName, 'FZC9FG8ISN.spark-merged.json');
    assert.equal(second.parsed.stackNodes, 115_559);
    await page.close();
});

await test('release ZIP extracted to a clean folder still runs from file://', async () => {
    const extracted = path.join(work, 'release-extracted');
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    execFileSync('tar.exe', ['-xf', releaseZip, '-C', extracted], { windowsHide: true });
    const { page, pageErrors } = await openPage(pathToFileURL(path.join(extracted, 'index.html')).href);
    const blocked = await convert(page, fViPath, { offline: true });
    assert.match(blocked.status, /转换未完成/);
    assert.equal(blocked.gateVisible, true);
    assert.equal(blocked.resultHidden, true);
    assert.equal(blocked.downloadHidden, true);
    assert.equal(blocked.parsed, null);

    const result = await convert(page, fViPath, { skipMappings: true });
    assert.ok(result.status.includes('转换完成'), result.status);
    assert.equal(result.qualityVisible, true);
    assert.equal(result.parsed.stackNodes, 20_304);
    assert.equal(result.parsed.metadataKeys.length, 18);
    assert.deepEqual(pageErrors, []);
    await page.close();
});

await test('drag/drop path works', async () => {
    const { page } = await openPage(undefined, { stubMapping: true });
    const base64 = readFileSync(fViPath).toString('base64');
    await page.evaluate(data => {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], 'dragged.sparkprofile', { type: 'application/octet-stream' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
        document.getElementById('dropzone').dispatchEvent(event);
    }, base64);
    await page.waitForFunction(() => document.getElementById('status')?.textContent.includes('转换完成'), { timeout: 45_000 });
    const result = await readResult(page);
    assert.equal(result.parsed.stackNodes, 20_304);
    await page.close();
});

await browser.close();

if (failures.length) {
    console.error(`\n${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
} else {
    console.log(`\nAll ${passed} browser acceptance tests passed.`);
}