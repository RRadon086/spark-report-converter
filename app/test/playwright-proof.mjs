import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import protobuf from 'protobufjs';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const pagePath = process.env.SPARK_PAGE_PATH
    ? path.resolve(process.env.SPARK_PAGE_PATH)
    : path.join(repoRoot, 'release', 'spark-report-converter', 'index.html');
const samplePath = path.join(
    process.env.SPARK_SAMPLES_DIR ? path.resolve(process.env.SPARK_SAMPLES_DIR) : path.join(repoRoot, 'spark'),
    'fViOWNasPc.sparkprofile'
);
const shotsDir = process.env.SPARK_SHOTS_DIR
    ? path.resolve(process.env.SPARK_SHOTS_DIR)
    : path.join(repoRoot, 'docs', 'TaskReport', 'screenshots', 'task-08');
const edgePath = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

assert.ok(existsSync(pagePath), `release page missing: ${pagePath}`);
assert.ok(existsSync(samplePath), `sample missing: ${samplePath}`);
rmSync(shotsDir, { recursive: true, force: true });
mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
});

const shots = [];
const summary = {};

// Deterministic mapping fixture: the mapping code path is real, but the
// external mapping service is not required for the visual proof.
const protoRoot = protobuf.parse(readFileSync(path.join(appRoot, 'vendor', 'spark.proto'), 'utf8')).root;
const McpMappings = protoRoot.lookupType('spark.McpMappings');
const mappingMetadataBody = JSON.stringify({ auto: { 'forge/1.20.1': 'mcp-1_20' } });
const mappingDataBody = Buffer.from(
    McpMappings.encode(McpMappings.create({ methods: { m_63085_: 'get' } })).finish()
);

async function openPage(viewport, options = {}) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    if (options.stubMapping) {
        await page.route('**/spark-mappings.lucko.me/dist/**', route => {
            if (route.request().url().endsWith('/dist/mappings.json')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: mappingMetadataBody,
                });
            }
            if (route.request().url().includes('/dist/1_20/mcp.wasm')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/wasm',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: mappingDataBody,
                });
            }
            return route.continue();
        });
    }
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: 'load' });
    await page.waitForSelector('#dropzone');
    return { page, pageErrors, consoleErrors };
}

async function shot(page, name) {
    const file = path.join(shotsDir, name);
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
}

async function assertNoOverflow(page) {
    const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
    }));
    assert.ok(overflow.scrollWidth <= overflow.viewport, `horizontal overflow: ${JSON.stringify(overflow)}`);
    assert.ok(overflow.bodyWidth <= overflow.viewport, `body overflow: ${JSON.stringify(overflow)}`);
    return overflow;
}

async function captureInitial(label, viewport) {
    const { page, pageErrors, consoleErrors } = await openPage(viewport);
    await shot(page, `initial-${label}.png`);
    await assertNoOverflow(page);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    summary[`${label}-initial`] = { state: 'initial', overflow: await assertNoOverflow(page) };
    await page.close();
}

async function captureSuccess(label, viewport) {
    const { page, pageErrors, consoleErrors } = await openPage(viewport, { stubMapping: true });
    await page.setInputFiles('#file-input', samplePath);
    await page.waitForFunction(() => document.getElementById('status')?.textContent.includes('转换完成'), { timeout: 45_000 });
    await shot(page, `success-${label}.png`);
    const state = await page.evaluate(() => ({
        aiVisible: (() => {
            const element = document.getElementById('ai-warning');
            return !!element && !element.hidden && getComputedStyle(element).display !== 'none';
        })(),
        qualityVisible: (() => {
            const element = document.getElementById('mapping-quality');
            return !!element && !element.hidden && getComputedStyle(element).display !== 'none';
        })(),
        text: document.body.textContent || '',
    }));
    assert.equal(state.aiVisible, true, 'AI warning is not visible');
    assert.equal(state.qualityVisible, false, 'quality warning should be hidden after successful mapping');
    assert.match(state.text, /v1\.0\.0/);
    assert.equal(state.text.includes('MVP'), false);
    assert.equal(state.text.includes('本地 HTML 版'), false);
    await assertNoOverflow(page);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    summary[`${label}-success`] = { state: 'success', overflow: await assertNoOverflow(page) };
    await page.close();
}

async function captureError(label, viewport) {
    const { page, pageErrors, consoleErrors } = await openPage(viewport);
    await page.setInputFiles('#file-input', {
        name: 'empty.sparkprofile',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(0),
    });
    await page.waitForFunction(() => {
        const details = document.getElementById('error-details');
        return details && !details.hidden;
    }, { timeout: 10_000 });
    await shot(page, `error-${label}.png`);
    const state = await page.evaluate(() => ({
        errorText: document.getElementById('error-detail')?.textContent || '',
        resultHidden: document.getElementById('result')?.hidden ?? true,
        downloadHidden: document.getElementById('download')?.hidden ?? true,
    }));
    assert.ok(state.errorText.length > 0);
    assert.equal(state.resultHidden, true);
    assert.equal(state.downloadHidden, true);
    await assertNoOverflow(page);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    summary[`${label}-error`] = { state: 'error', overflow: await assertNoOverflow(page) };
    await page.close();
}

async function captureMappingFailure(label, viewport) {
    const { page, pageErrors } = await openPage(viewport);
    await page.context().setOffline(true);
    await page.setInputFiles('#file-input', samplePath);
    await page.waitForFunction(() => document.getElementById('status')?.textContent.includes('转换未完成'), { timeout: 45_000 });
    await shot(page, `mapping-failure-${label}.png`);
    const state = await page.evaluate(() => {
        const gate = document.getElementById('mapping-gate');
        const result = document.getElementById('result');
        const download = document.getElementById('download');
        return {
            gateVisible: !!gate && !gate.hidden,
            gateText: gate?.textContent || '',
            gateDetail: document.getElementById('gate-detail')?.textContent || '',
            resultHidden: result ? result.hidden : true,
            downloadHidden: download ? download.hidden : true,
            overflow: {
                viewport: window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                bodyWidth: document.body.scrollWidth,
            },
        };
    });
    assert.equal(state.gateVisible, true);
    assert.match(state.gateText, /转换已暂停：无法获取方法名映射/);
    assert.match(state.gateText, /AI 对调用链和问题的分析质量/);
    assert.match(state.gateText, /跳过联网映射/);
    assert.ok(state.gateDetail.length > 0);
    assert.equal(state.resultHidden, true);
    assert.equal(state.downloadHidden, true);
    assert.ok(state.overflow.scrollWidth <= state.overflow.viewport);
    assert.ok(state.overflow.bodyWidth <= state.overflow.viewport);
    assert.deepEqual(pageErrors, []);
    summary[`${label}-mapping-failure`] = { state: 'mapping-failure', overflow: state.overflow };
    await page.context().setOffline(false);
    await page.close();
}

async function captureSkipped(label, viewport) {
    const { page, pageErrors, consoleErrors } = await openPage(viewport);
    await page.check('#skip-mappings');
    await page.setInputFiles('#file-input', samplePath);
    await page.waitForFunction(() => document.getElementById('status')?.textContent.includes('转换完成'), { timeout: 45_000 });
    await shot(page, `skipped-${label}.png`);
    const state = await page.evaluate(() => ({
        qualityVisible: (() => {
            const element = document.getElementById('mapping-quality');
            return !!element && !element.hidden && getComputedStyle(element).display !== 'none';
        })(),
        qualityText: document.getElementById('mapping-quality')?.textContent || '',
        text: document.body.textContent || '',
    }));
    assert.equal(state.qualityVisible, true);
    assert.match(state.qualityText, /AI 分析质量可能下降/);
    assert.match(state.text, /已主动跳过联网映射/);
    assert.match(state.text, /v1\.0\.0/);
    await assertNoOverflow(page);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    summary[`${label}-skipped`] = { state: 'skipped', overflow: await assertNoOverflow(page) };
    await page.close();
}

for (const [label, viewport] of [
    ['desktop', { width: 1280, height: 1000 }],
    ['mobile', { width: 390, height: 844 }],
]) {
    await captureInitial(label, viewport);
    await captureSuccess(label, viewport);
    await captureMappingFailure(label, viewport);
    await captureSkipped(label, viewport);
    await captureError(label, viewport);
}

await browser.close();
console.log(JSON.stringify({ summary, screenshots: shots }, null, 2));