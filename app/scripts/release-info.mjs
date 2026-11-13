import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Shared names for the runtime release and its corresponding-source archive. */
export async function releaseInfo(root) {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const releaseRoot = path.resolve(root, '..', 'release');
    const base = `spark-report-converter-v${pkg.version}`;
    return {
        version: pkg.version,
        releaseRoot,
        runtimeFolder: path.join(releaseRoot, 'spark-report-converter'),
        runtimeZip: path.join(releaseRoot, `${base}.zip`),
        sourceFolder: path.join(releaseRoot, `${base}-source`),
        sourceZip: path.join(releaseRoot, `${base}-source.zip`),
    };
}