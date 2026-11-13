import { JsonDownload } from './export';
import type { MappingResult } from './mappings';

type StatusKind = 'idle' | 'busy' | 'ok' | 'warn' | 'error';

export interface SuccessInfo {
    inputName: string;
    json: string;
    summaryBytes: number;
    metadataBytes: number;
    mapping: MappingResult;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * All DOM interaction lives here. main.ts only coordinates the conversion
 * pipeline; it never touches elements directly.
 */
export class AppUi {
    private readonly dropzone: HTMLDivElement;
    private readonly fileInput: HTMLInputElement;
    private readonly skipMappingsEl: HTMLInputElement;
    private readonly statusEl: HTMLDivElement;
    private readonly resultEl: HTMLElement;
    private readonly resultFileEl: HTMLDivElement;
    private readonly sizesEl: HTMLDivElement;
    private readonly mappingEl: HTMLDivElement;
    private readonly mappingQualityEl: HTMLDivElement;
    private readonly mappingDetails: HTMLDetailsElement;
    private readonly mappingDetailEl: HTMLPreElement;
    private readonly mappingGate: HTMLElement;
    private readonly gateDetails: HTMLDetailsElement;
    private readonly gateDetailEl: HTMLPreElement;
    private readonly gateCopyEl: HTMLButtonElement;
    private readonly errorDetails: HTMLDetailsElement;
    private readonly errorDetailEl: HTMLPreElement;
    private readonly detailCopyEl: HTMLButtonElement;
    private readonly mappingCopyEl: HTMLButtonElement;
    private readonly resetEl: HTMLButtonElement;
    private readonly downloadEl: HTMLAnchorElement;
    private readonly download: JsonDownload;

    private busy = false;
    private fileHandler: ((file: File) => void) | null = null;

    constructor() {
        this.dropzone = this.require<HTMLDivElement>('dropzone');
        this.fileInput = this.require<HTMLInputElement>('file-input');
        this.skipMappingsEl = this.require<HTMLInputElement>('skip-mappings');
        this.statusEl = this.require<HTMLDivElement>('status');
        this.resultEl = this.require<HTMLElement>('result');
        this.resultFileEl = this.require<HTMLDivElement>('result-file');
        this.sizesEl = this.require<HTMLDivElement>('sizes');
        this.mappingEl = this.require<HTMLDivElement>('mapping-status');
        this.mappingQualityEl = this.require<HTMLDivElement>('mapping-quality');
        this.mappingDetails = this.require<HTMLDetailsElement>('mapping-error-details');
        this.mappingDetailEl = this.require<HTMLPreElement>('mapping-error-detail');
        this.mappingGate = this.require<HTMLElement>('mapping-gate');
        this.gateDetails = this.require<HTMLDetailsElement>('gate-details');
        this.gateDetailEl = this.require<HTMLPreElement>('gate-detail');
        this.gateCopyEl = this.require<HTMLButtonElement>('gate-copy');
        this.errorDetails = this.require<HTMLDetailsElement>('error-details');
        this.errorDetailEl = this.require<HTMLPreElement>('error-detail');
        this.detailCopyEl = this.require<HTMLButtonElement>('detail-copy');
        this.mappingCopyEl = this.require<HTMLButtonElement>('mapping-copy');
        this.resetEl = this.require<HTMLButtonElement>('reset');
        this.downloadEl = this.require<HTMLAnchorElement>('download');
        this.download = new JsonDownload(this.downloadEl);

        this.bindEvents();
        this.clearOutput();
    }

    get skipMappings(): boolean {
        return this.skipMappingsEl.checked;
    }

    onFileSelected(handler: (file: File) => void): void {
        this.fileHandler = handler;
    }

    setBusy(value: boolean): void {
        this.busy = value;
        this.fileInput.disabled = value;
        this.resetEl.disabled = value;
        this.dropzone.classList.toggle('busy', value);
        this.dropzone.setAttribute('aria-busy', String(value));
    }

    setStatus(message: string, kind: StatusKind = 'idle'): void {
        this.statusEl.textContent = message;
        this.statusEl.className = `status ${kind}`;
    }

    clearOutput(): void {
        this.download.clear();
        this.resultEl.hidden = true;
        this.errorDetails.hidden = true;
        this.errorDetails.open = false;
        this.mappingDetails.hidden = true;
        this.mappingDetails.open = false;
        this.mappingGate.hidden = true;
        this.gateDetails.open = false;
        this.mappingQualityEl.hidden = true;
        this.errorDetailEl.textContent = '';
        this.mappingDetailEl.textContent = '';
        this.gateDetailEl.textContent = '';
        this.mappingEl.textContent = '';
        this.mappingEl.className = 'mapping';
        this.mappingQualityEl.textContent = '';
        this.resultFileEl.textContent = '';
        this.sizesEl.textContent = '';
    }

    showError(message: string, detail: string): void {
        this.clearOutput();
        this.setStatus(message, 'error');
        this.errorDetailEl.textContent = detail || message;
        this.errorDetails.hidden = false;
        this.errorDetails.open = true;
    }

    showSuccess(info: SuccessInfo): void {
        this.errorDetails.hidden = true;
        this.errorDetails.open = false;
        const download = this.download.set(info.inputName, info.json);
        this.resultEl.hidden = false;
        this.resultFileEl.textContent = `来源文件：${info.inputName}`;
        this.sizesEl.textContent = `合并 JSON：${formatBytes(download.bytes)}`;
        this.renderMapping(info.mapping);

        if (info.mapping.status === 'ok') {
            this.mappingQualityEl.hidden = true;
            this.setStatus('转换完成。已生成可下载的 JSON。', 'ok');
        } else if (info.mapping.status === 'skipped') {
            this.mappingQualityEl.hidden = false;
            this.mappingQualityEl.textContent =
                '已主动跳过联网映射；部分方法名未解析，AI 分析质量可能下降。';
            this.setStatus(
                '转换完成。已主动跳过联网映射；部分方法名未解析，AI 分析质量可能下降。',
                'warn'
            );
        } else {
            this.mappingQualityEl.hidden = false;
            this.mappingQualityEl.textContent =
                '映射未完成；部分方法名未解析，AI 分析质量可能下降。';
            this.setStatus(
                '转换完成，但映射未完成；部分方法名未解析，AI 分析质量可能下降。',
                'warn'
            );
        }
    }

    showMappingGate(mapping: MappingResult): void {
        this.clearOutput();
        this.mappingGate.hidden = false;
        this.gateDetails.open = false;
        this.gateDetailEl.textContent = mapping.detail || mapping.message;
        this.setStatus('转换未完成：未生成 JSON。', 'warn');
    }

    private renderMapping(mapping: MappingResult): void {
        this.mappingEl.className = `mapping ${mapping.status}`;
        this.mappingEl.textContent = mapping.message;
        this.mappingDetails.hidden = !mapping.detail;
        this.mappingDetails.open = false;
        this.mappingDetailEl.textContent = mapping.detail || '';
    }

    private bindEvents(): void {
        this.dropzone.addEventListener('dragover', event => {
            event.preventDefault();
            if (!this.busy) this.dropzone.classList.add('dragging');
        });
        this.dropzone.addEventListener('dragleave', () => {
            this.dropzone.classList.remove('dragging');
        });
        this.dropzone.addEventListener('drop', event => {
            event.preventDefault();
            this.dropzone.classList.remove('dragging');
            if (this.busy) return;
            const file = event.dataTransfer?.files?.[0];
            if (file) this.fileHandler?.(file);
        });
        this.dropzone.addEventListener('click', () => {
            if (!this.busy) this.fileInput.click();
        });
        this.dropzone.addEventListener('keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && !this.busy) {
                event.preventDefault();
                this.fileInput.click();
            }
        });
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            this.fileInput.value = '';
            if (file) this.fileHandler?.(file);
        });

        this.resetEl.addEventListener('click', () => {
            if (this.busy) return;
            this.fileInput.value = '';
            this.clearOutput();
            this.setStatus('等待选择 .sparkprofile 文件。', 'idle');
        });

        this.detailCopyEl.addEventListener('click', () => {
            void this.copyDetails(this.errorDetailEl, this.detailCopyEl);
        });
        this.mappingCopyEl.addEventListener('click', () => {
            void this.copyDetails(this.mappingDetailEl, this.mappingCopyEl);
        });
        this.gateCopyEl.addEventListener('click', () => {
            void this.copyDetails(this.gateDetailEl, this.gateCopyEl);
        });
    }

    private async copyDetails(source: HTMLElement, button: HTMLButtonElement): Promise<void> {
        const original = button.textContent || '复制技术详情';
        try {
            await navigator.clipboard.writeText(source.textContent || '');
            button.textContent = '已复制';
        } catch {
            const range = document.createRange();
            range.selectNodeContents(source);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            button.textContent = '已选中，请按 Ctrl+C';
        }
        setTimeout(() => (button.textContent = original), 2000);
    }

    private require<T extends HTMLElement>(id: string): T {
        const element = document.getElementById(id);
        if (!element) throw new Error(`missing element #${id}`);
        return element as T;
    }
}