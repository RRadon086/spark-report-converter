import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releaseInfo } from './release-info.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const info = await releaseInfo(root);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.build', '.cache']);

async function copySourceTree(source, target) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);
        if (entry.isDirectory()) {
            await copySourceTree(from, to);
        } else if (entry.isFile()) {
            await copyFile(from, to);
        }
    }
}

await rm(info.sourceFolder, { recursive: true, force: true });
await rm(info.sourceZip, { force: true });
await mkdir(info.sourceFolder, { recursive: true });

const sourceApp = path.join(info.sourceFolder, 'app');
await copySourceTree(root, sourceApp);

await writeFile(
    path.join(info.sourceFolder, 'README.md'),
    [
        `# Spark 报告转换器 v${info.version} · 对应源码`,
        '',
        '源码位于本目录下的 `app/`。',
        '',
        '## 构建 / 发布',
        '',
        '1. 安装 Node.js >= 20（仅构建需要，运行发布包不需要 Node）；',
        '2. 进入 `app/`；',
        '3. `npm ci`；',
        '4. `npm run build`；',
        '5. `npm run release`。',
        '',
        '`npm run release` 会重新生成运行发布目录和两个 ZIP（运行包与对应源码包），',
        '生成位置为解压目录下的 `release/`。',
        '',
        '## 源码包不包含',
        '',
        '- Node 运行时、`node_modules`、`dist`、测试临时产物；',
        '- 真实 Spark 样本、AI 解读、截图或其他敏感数据。',
        '',
        '真实样本可在本地 `spark/` 目录提供后运行 `app/npm test` 和 `app/npm run test:browser`。',
        '',
        '许可证：GPL-3.0，见 `app/LICENSE`；第三方来源见 `app/NOTICE.md`。',
        '',
    ].join('\r\n'),
    'utf8'
);

execFileSync('tar.exe', ['-a', '-c', '-f', info.sourceZip, '-C', info.sourceFolder, '.'], {
    stdio: 'inherit',
    windowsHide: true,
});

const infoStat = await stat(info.sourceZip);
await rm(info.sourceFolder, { recursive: true, force: true });
console.log(`Source ZIP: ${info.sourceZip} (${infoStat.size} B)`);