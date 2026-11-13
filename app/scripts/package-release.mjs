import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releaseInfo } from './release-info.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const info = await releaseInfo(root);

if (!existsSync(info.sourceZip)) {
    throw new Error(
        `Missing corresponding source ZIP: ${info.sourceZip}\n` +
        'Run: npm run source (or npm run release) before packaging the runtime ZIP.'
    );
}

await rm(info.runtimeFolder, { recursive: true, force: true });
await rm(info.runtimeZip, { force: true });
await mkdir(info.runtimeFolder, { recursive: true });

const runtimeFiles = [
    ['dist/app.js', 'app.js'],
    ['dist/index.html', 'index.html'],
    ['dist/styles.css', 'styles.css'],
    ['USAGE.md', 'README.md'],
    ['LICENSE', 'LICENSE'],
    ['NOTICE.md', 'NOTICE.md'],
];

for (const [source, target] of runtimeFiles) {
    await copyFile(path.join(root, source), path.join(info.runtimeFolder, target));
}

const sourceZipName = path.basename(info.sourceZip);
await writeFile(
    path.join(info.runtimeFolder, 'SOURCE.txt'),
    [
        `Spark 报告转换器 v${info.version}`,
        '',
        `对应源码 ZIP：${sourceZipName}`,
        '该源码 ZIP 与本发布 ZIP 位于同一 release/ 目录。',
        '',
        '源码 ZIP 内含 app/ 的 TypeScript 源码、构建脚本、proto、package.json、package-lock.json、LICENSE、NOTICE 与构建说明。',
        '构建：安装 Node.js >= 20，解压源码 ZIP，进入 app/，执行 npm ci、npm run build、npm run release。',
        '',
        '本项目按 GPL-3.0 发布；第三方来源与许可证说明见 NOTICE.md，许可证全文见 LICENSE。',
        '本发布包不包含 Node 运行时；用户只需要 Windows 10/11 自带 Edge。',
        '',
    ].join('\r\n'),
    'utf8'
);

// Windows 10/11 ships bsdtar. It creates a ZIP when the output name ends in
// .zip and avoids relying on the optional PowerShell Compress-Archive module.
execFileSync('tar.exe', ['-a', '-c', '-f', info.runtimeZip, '-C', info.runtimeFolder, '.'], {
    stdio: 'inherit',
    windowsHide: true,
});

const runtimeStat = await stat(info.runtimeZip);
const sourceStat = await stat(info.sourceZip);
console.log(`Release folder: ${info.runtimeFolder}`);
console.log(`Release ZIP:    ${info.runtimeZip} (${runtimeStat.size} B)`);
console.log(`Source ZIP:     ${info.sourceZip} (${sourceStat.size} B)`);