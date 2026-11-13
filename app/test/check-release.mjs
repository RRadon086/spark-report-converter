import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInfo } from '../scripts/release-info.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const info = await releaseInfo(appRoot);
const folder = info.runtimeFolder;
const zipPath = info.runtimeZip;
const sourceZipPath = info.sourceZip;

assert.ok(existsSync(folder), `missing release folder: ${folder}`);
assert.ok(existsSync(zipPath), `missing release ZIP: ${zipPath}`);
assert.ok(existsSync(sourceZipPath), `missing source ZIP: ${sourceZipPath}`);

const required = ['index.html', 'app.js', 'styles.css', 'README.md', 'LICENSE', 'NOTICE.md', 'SOURCE.txt'];
const folderFiles = readdirSync(folder).filter(name => statSync(path.join(folder, name)).isFile());
assert.deepEqual(folderFiles.sort(), [...required].sort(), 'release folder must contain exactly the runtime files');

const entries = execFileSync('tar.exe', ['-tf', zipPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(line => line.replace(/^\.\//, '').replace(/\/$/, ''))
    .filter(Boolean);
const top = entries.filter(entry => !entry.includes('/'));
assert.deepEqual(top.sort(), [...required].sort(), 'ZIP must contain exactly the runtime files at its root');

for (const forbidden of ['src/', 'node_modules/', 'package.json', 'package-lock.json', 'app.js.map', 'dist/']) {
    assert.equal(entries.some(entry => entry === forbidden.replace(/\/$/, '') || entry.startsWith(forbidden)), false, `ZIP contains forbidden ${forbidden}`);
}

const sourceText = readFileSync(path.join(folder, 'SOURCE.txt'), 'utf8');
const sourceZipName = path.basename(sourceZipPath);
assert.match(sourceText, new RegExp(sourceZipName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(sourceText, /npm ci/);
assert.match(sourceText, /npm run build/);
assert.match(sourceText, /npm run release/);
assert.match(sourceText, /GPL-3\.0/);

const sourceEntries = execFileSync('tar.exe', ['-tf', sourceZipPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(line => line.replace(/^\.\//, '').replace(/\/$/, ''))
    .filter(Boolean);

for (const requiredSource of [
    'README.md',
    'app/package.json',
    'app/package-lock.json',
    'app/tsconfig.json',
    'app/index.html',
    'app/styles.css',
    'app/src/main.ts',
    'app/src/decode.ts',
    'app/src/adapter.ts',
    'app/src/mappings.ts',
    'app/src/merge.ts',
    'app/src/export.ts',
    'app/src/errors.ts',
    'app/src/ui.ts',
    'app/src/SummaryGenerator.ts',
    'app/scripts/build.mjs',
    'app/scripts/package-release.mjs',
    'app/scripts/package-source.mjs',
    'app/vendor/spark.proto',
    'app/LICENSE',
    'app/NOTICE.md',
    'app/README.md',
    'app/USAGE.md',
]) {
    assert.ok(sourceEntries.includes(requiredSource), `source ZIP missing ${requiredSource}`);
}

for (const forbidden of [
    'node_modules/',
    'dist/',
    'test/.build/',
    'spark/',
    'task-01-artifacts/',
    'screenshots/',
]) {
    assert.equal(
        sourceEntries.some(entry => entry === forbidden.replace(/\/$/, '') || entry.startsWith(forbidden)),
        false,
        `source ZIP contains forbidden ${forbidden}`
    );
}
for (const entry of sourceEntries) {
    assert.equal(/\.(sparkprofile|sparkheap|sparkhealth)$/i.test(entry), false, `source ZIP contains sample ${entry}`);
}

const index = readFileSync(path.join(folder, 'index.html'), 'utf8');
assert.match(index, /<script src="app\.js" defer><\/script>/);
assert.match(index, /href="styles\.css"/);
assert.doesNotMatch(index, /cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare/);

const app = readFileSync(path.join(folder, 'app.js'), 'utf8');
assert.doesNotMatch(app, /cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare/);

const readme = readFileSync(path.join(folder, 'README.md'), 'utf8');
assert.match(readme, /Windows 10 \/ 11/);
assert.match(readme, /Edge/);
assert.match(readme, /隐私|敏感/);

const license = readFileSync(path.join(folder, 'LICENSE'), 'utf8');
assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
assert.match(license, /Version 3/);

const runtimeInfo = statSync(zipPath);
const sourceInfo = statSync(sourceZipPath);
console.log(`Release folder: ${folder}`);
console.log(`Release ZIP:    ${zipPath} (${runtimeInfo.size} B)`);
console.log(`Source ZIP:     ${sourceZipPath} (${sourceInfo.size} B)`);
console.log(`Runtime entries: ${entries.join(', ')}`);
console.log(`Source entries:  ${sourceEntries.length} files`);
console.log('Release check passed: runtime + corresponding source, no source/Node files in runtime ZIP.');