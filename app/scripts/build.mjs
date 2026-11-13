import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, 'src/main.ts')],
    outfile: path.join(dist, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    charset: 'utf8',
    legalComments: 'inline',
    loader: { '.proto': 'text' },
    logLevel: 'info',
});

await copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await copyFile(path.join(root, 'styles.css'), path.join(dist, 'styles.css'));

console.log(`Built ${path.join(dist, 'app.js')}`);