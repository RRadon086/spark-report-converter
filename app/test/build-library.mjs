import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test', '.build');
const outfile = path.join(outDir, 'library.mjs');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, 'test', 'library-entry.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    loader: { '.proto': 'text' },
    logLevel: 'warning',
});

console.log(`Built ${outfile}`);