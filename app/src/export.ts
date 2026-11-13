export interface DownloadResult {
    fileName: string;
    bytes: number;
}

/**
 * Turn the selected profile name into the download name while keeping it
 * filesystem-safe on Windows.
 */
export function downloadFileName(inputName: string): string {
    const base = String(inputName || '')
        .replace(/\.sparkprofile$/i, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .trim();
    return `${base || 'spark-report'}.spark-merged.json`;
}

/**
 * Owns the blob URL and the download anchor. Clearing the controller removes
 * the href/download attributes as well as hiding the button, so an old result
 * cannot be downloaded after a new conversion starts or a conversion fails.
 */
export class JsonDownload {
    private url: string | null = null;

    constructor(private readonly anchor: HTMLAnchorElement) {}

    clear(): void {
        if (this.url) {
            URL.revokeObjectURL(this.url);
            this.url = null;
        }
        this.anchor.removeAttribute('href');
        this.anchor.removeAttribute('download');
        this.anchor.hidden = true;
    }

    set(inputName: string, json: string): DownloadResult {
        this.clear();
        const fileName = downloadFileName(inputName);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        this.url = URL.createObjectURL(blob);
        this.anchor.href = this.url;
        this.anchor.download = fileName;
        this.anchor.hidden = false;
        return { fileName, bytes: blob.size };
    }
}