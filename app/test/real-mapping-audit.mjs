import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    : path.join(repoRoot, 'docs', 'TaskReport', 'screenshots', 'task-09');
if (!existsSync(pagePath)) throw new Error(`page missing: ${pagePath}`);
if (!existsSync(samplePath)) throw new Error(`sample missing: ${samplePath}`);
mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
    executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const pageErrors = [];
const consoleErrors = [];
const externalRequests = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('request', request => {
    const url = request.url();
    if (/^https?:/i.test(url)) {
        try { externalRequests.push(new URL(url).hostname); } catch { /* ignore */ }
    }
});
await page.goto(pathToFileURL(pagePath).href, { waitUntil: 'load' });
await page.setInputFiles('#file-input', samplePath);

let waitError = null;
try {
    await page.waitForFunction(() => {
        const text = document.getElementById('status')?.textContent || '';
        return text.includes('转换完成') || text.includes('转换未完成');
    }, { timeout: 15_000 });
} catch (error) {
    waitError = String(error);
}

const appResult = await page.evaluate(() => {
    const gate = document.getElementById('mapping-gate');
    return {
        status: document.getElementById('status')?.textContent || '',
        gateVisible: !!gate && !gate.hidden,
        gateDetail: document.getElementById('gate-detail')?.textContent || '',
        downloadHidden: document.getElementById('download')?.hidden ?? true,
        resultHidden: document.getElementById('result')?.hidden ?? true,
    };
});
await page.screenshot({ path: path.join(shotsDir, 'real-mapping-attempt-desktop.png'), fullPage: true });

// Independent HTTP check of the same browser networking stack. It is not the
// app's 8-second mapping promise, but shows whether the browser can reach the
// public service at all.
const httpCheck = await page.evaluate(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const start = performance.now();
    try {
        const response = await fetch('https://spark-mappings.lucko.me/dist/mappings.json', {
            signal: controller.signal,
            mode: 'cors',
            cache: 'no-cache',
        });
        return {
            ok: response.ok,
            status: response.status,
            ms: performance.now() - start,
            bytes: (await response.text()).length,
        };
    } catch (error) {
        return { error: String(error), ms: performance.now() - start };
    } finally {
        clearTimeout(timer);
    }
}).catch(error => ({ error: String(error) }));

await browser.close();
const allowedHosts = new Set(['spark-mappings.lucko.me']);
const unexpectedHosts = [...new Set(externalRequests)].filter(host => !allowedHosts.has(host));
console.log(JSON.stringify({
    appResult,
    waitError,
    httpCheck,
    externalHosts: [...new Set(externalRequests)],
    unexpectedHosts,
    pageErrors,
    consoleErrors,
}, null, 2));

if (unexpectedHosts.length) process.exitCode = 2;
if (pageErrors.length) process.exitCode = 3;