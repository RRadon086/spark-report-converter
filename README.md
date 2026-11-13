# Spark 报告转换器

一个无需安装运行环境的本地小工具：把 Minecraft Spark 的 `.sparkprofile` 性能采样报告，转换成适合 AI 分析的单个 JSON 文件。

工具在浏览器内完成解析和摘要，保留性能热点、调用链证据以及完整的报告信息。普通用户解压后用 Microsoft Edge 打开即可，不需要安装 Node.js、Python、Docker 或本地服务器。

## 开发与验证说明

**本工具的代码完全由 AI 生成**。虽然已进行 AI 自动化测试和真实样本验证，但测试环境与样本范围有限，仍可能存在尚未发现或未被现有测试覆盖的问题。如果你需要经过更广泛验证的方案，可以选择其他的社区工具。

## 特点

- 输出紧凑的性能摘要，同时保留硬件、内存、模组、实体和配置等完整信息；
- 默认通过 Spark 官方服务解析混淆方法名，提高 AI 分析的可读性；
- 映射获取失败时默认暂停转换，避免静默生成低质量结果；
- 用户主动跳过映射后仍可离线转换，并会收到质量下降提醒；
- 报告不会上传到本项目服务器，唯一的外部请求是可选的 Spark 映射服务；
- 明确提示隐私风险，以及采纳 AI 建议前的备份要求。

**普通用户使用说明**见 [`app/USAGE.md`](app/USAGE.md)。

## 支持范围

在 Windows 10/11 自带的 Microsoft Edge 浏览器上测试通过，仅处理 Spark 性能采样报告 `.sparkprofile`，支持未压缩 protobuf 和 gzip 输入。

不支持 heap、health、Spark 查看器链接或批量转换；不保证兼容所有历史和未来 Spark 版本。

## 仓库结构

```text
.
└── app/
    ├── index.html             页面结构
    ├── styles.css             页面样式
    ├── src/                   转换、映射、界面与导出代码
    ├── vendor/spark.proto     Spark 数据结构定义
    ├── scripts/               构建与发布脚本
    ├── test/                  逻辑、浏览器和发布检查
    ├── package.json           依赖与命令
    ├── package-lock.json      锁定依赖版本
    ├── USAGE.md               用户使用说明
    ├── LICENSE                GPL-3.0 许可证
    └── NOTICE.md              来源与第三方说明
```

核心摘要逻辑复用 `spark-viewer-extract`，**具体来源和修改**见 [`app/NOTICE.md`](app/NOTICE.md)。

## 构建

仅开发和构建需要 Node.js 20 或更高版本；最终用户不需要安装。

```bash
cd app
npm ci
npm run build
```

构建结果位于 `app/dist/`，包含可直接运行的 `index.html`、`app.js` 和 `styles.css`。

## 生成发布包

```bash
cd app
npm run release
```

该命令会依次构建、生成对应源码包和运行包，输出到仓库根目录的 `release/`：

- `spark-report-converter/`：可直接运行的目录；
- `spark-report-converter-v1.0.0.zip`：运行包；
- `spark-report-converter-v1.0.0-source.zip`：对应源码包。

只需重新生成源码包时，可执行 `npm run source`。

运行包不包含 TypeScript 源码、Node.js、`node_modules` 或构建工具；其中的 `SOURCE.txt` 会标明对应源码的获取方式。

## 测试

```bash
cd app
npm run typecheck         # TypeScript 类型检查
npm test                  # 解码、合并、异常和关键统计测试
npm run test:browser      # Edge + file:// 浏览器验收，会先生成发布包
npm run test:proof        # Playwright + Edge 关键流程与截图
npm run test:real-mapping # 尝试真实外部映射服务，结果单独记录
npm run test:release      # 检查运行包、源码包和 SOURCE.txt
```

真实样本不进入源码仓库或发布包。测试前需自行准备 `.sparkprofile` 样本，并通过 `SPARK_SAMPLES_DIR` 指定样本目录。还可使用：

- `EDGE_PATH`：指定 Edge 可执行文件；
- `SPARK_PAGE_PATH`：指定要验收的页面；
- `SPARK_SHOTS_DIR`：指定截图输出目录；
- `SPARK_RELEASE_ZIP`：指定要验收的运行 ZIP。

真实外部映射测试受网络和 Spark 服务状态影响，不能与使用本地确定性数据的回归测试混为一谈。

## 输出结构

```json
{
  "schema": "spark_merged.v1",
  "summary": { "schema": "spark_summary.v1" },
  "metadata": {}
}
```

- `summary`：性能热点、热线程、最差时间窗口和代表性调用栈；
- `metadata`：原报告的完整信息，目前不做脱敏；
- 默认映射获取或解析失败时不生成结果；只有用户主动跳过映射才允许降级输出。

## 许可证

本项目按 GPL-3.0 发布。**许可证全文**见 [`app/LICENSE`](app/LICENSE)，**直接复用的代码**、**第三方依赖**和**映射服务来源**见 [`app/NOTICE.md`](app/NOTICE.md)。
