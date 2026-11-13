import { adaptSamplerData } from './adapter';
import {
    assertSupportedFileName,
    decodeSamplerFile,
} from './decode';
import { userDetail, userMessage } from './errors';
import { buildMergedReport } from './merge';
import { loadMappings } from './mappings';
import { generateSparkSummary } from './SummaryGenerator';
import { AppUi } from './ui';

const ui = new AppUi();
let busy = false;

async function yieldToUi(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

async function handleFile(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    ui.setBusy(true);

    // The old result is revoked immediately: a new attempt must never leave
    // the previous file's download link usable, whether this attempt succeeds
    // or fails.
    ui.clearOutput();

    try {
        assertSupportedFileName(file.name || '');
        ui.setStatus(`正在读取 ${file.name}…`, 'busy');
        await yieldToUi();

        const buffer = await file.arrayBuffer();
        ui.setStatus('正在解码 Spark 报告…', 'busy');
        await yieldToUi();
        const decoded = decodeSamplerFile(buffer);

        const skipMappings = ui.skipMappings;
        ui.setStatus(
            skipMappings
                ? '已跳过联网映射，正在生成摘要…'
                : '正在获取方法名映射；默认失败会暂停转换…',
            'busy'
        );
        await yieldToUi();
        const mapping = await loadMappings(decoded.data.metadata, {
            skip: skipMappings,
        });

        if (!skipMappings && mapping.status === 'failed') {
            ui.showMappingGate(mapping);
            return;
        }

        ui.setStatus('正在生成紧凑调用树 Summary 并合并 metadata…', 'busy');
        await yieldToUi();
        const summary = generateSparkSummary(adaptSamplerData(decoded.data, mapping));
        const merged = buildMergedReport(summary, decoded.data.metadata, mapping);
        const json = JSON.stringify(merged);

        const summaryBytes = new Blob([JSON.stringify(summary)]).size;
        const metadataBytes = new Blob([JSON.stringify(decoded.data.metadata)]).size;

        ui.showSuccess({
            inputName: file.name,
            json,
            summaryBytes,
            metadataBytes,
            mapping,
        });
    } catch (error) {
        ui.showError(userMessage(error), userDetail(error));
    } finally {
        busy = false;
        ui.setBusy(false);
    }
}

ui.onFileSelected(file => {
    void handleFile(file);
});