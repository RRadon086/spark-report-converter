# 来源与许可证说明

## 直接复用的代码

以下文件来自 **FastMirror-MC/spark-viewer-extract**（fork 自 `lucko/spark-viewer`），采用 **GPL-3.0**：

- 仓库：https://github.com/FastMirror-MC/spark-viewer-extract
- 对应提交：`25f16bc94323352e96f8ae49f5b6fcd1224b9ead`（2026-05-29）

| 本项目文件 | 上游文件 | 修改 |
|---|---|---|
| `src/SummaryGenerator.ts` | `src/viewer/sampler/export/SummaryGenerator.ts` | 仅增加来源与许可证头注释，摘要逻辑未改 |
| `src/SummaryTypes.ts` | `src/viewer/sampler/export/SummaryTypes.ts` | 仅增加来源与许可证头注释 |
| `src/ExportModel.ts` | `src/viewer/sampler/export/ExportModel.ts` | 仅增加来源与许可证头注释 |
| `vendor/spark.proto` | `proto/spark.proto` | 追加官方 Java schema 的 `samplerEngineVersion`（17）、`Metrics`（18）及相应消息，保留完整 metadata |

`src/decode.ts`、`adapter.ts`、`mappings.ts`、`merge.ts`、`export.ts`、`ui.ts` 和 `main.ts` 为本项目实现。`adapter.ts` 只重建 SummaryGenerator 所需的扁平调用树与来源映射，不复制 Viewer 的 NodeMap、BottomUpMap 或 UI 代码。

## 参考项目

以下项目仅作为格式、解析或输出思路参考：

- **lucko/spark**：官方 Java proto 与原始数据说明  
  https://github.com/lucko/spark  
  https://spark.lucko.me/docs/misc/Raw-spark-data
- **lucko/spark-viewer**：映射机制、proto 与摘要思路  
  https://github.com/lucko/spark-viewer
- **Imanity-Software/spark-profiler-mcp**：扁平调用树解析思路（MIT）
  https://github.com/Imanity-Software/spark-profiler-mcp
- **imSirr/spark-analyzer**：输出思路（PolyForm Noncommercial 1.0.0）
  https://github.com/imSirr/spark-analyzer

## 第三方运行库

| 库 | 锁定版本 | 许可证 | 用途 |
|---|---|---|---|
| protobufjs | 7.4.0 | BSD-3-Clause | 在浏览器中解析 protobuf |
| pako | 2.1.0 | MIT / Zlib | 解压 gzip 输入 |

构建与测试依赖（包括 esbuild、TypeScript、puppeteer-core 等）不进入运行发布包，版本记录在 `package.json` 和 `package-lock.json` 中。

## Spark 映射服务

- 映射目录：https://spark-mappings.lucko.me/dist/mappings.json
- 映射数据：`https://spark-mappings.lucko.me/dist/<version>/<type>.wasm`
- 请求机制参考 `spark-viewer` 的 `src/viewer/sampler/mappings/`；这些 `.wasm` 文件实际为 protobuf 数据。
- 本项目不内置映射数据。仅在用户转换且未勾选“跳过联网映射”时请求映射服务，不会向该服务发送报告文件。

## 本项目许可证

本项目按 **GPL-3.0** 发布，许可证全文见 `LICENSE`。

对外分发时，请保留本说明、`LICENSE` 和对应源代码获取方式。本项目源码位于发布仓库的 `app/` 目录。
