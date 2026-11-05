---
title: 页面组件
description: "页面组件是“一个可独立描述的界面单元”，负责把复合组件按真实信息层级组装起来，并声明它的路由、状态与恢复方式。浏览器侧 6 个页面共用同一个注入宿主（开发服务器渲染的站点页面），终端侧 7 个页面共用 stdout/stderr 两个通道；13 个页面之外还有 3 个编辑器表面，它们没有自有页面（详见 27.4）。页面状态一律由 20 章(/design/states/) 的状态模型派生，本页只引用不新增"
sidebar:
  order: 27
  label: 页面组件
draft: false
lastUpdated: 2026-11-04
---

## 27. Page Components

页面组件是“一个可独立描述的界面单元”，负责把复合组件按真实信息层级组装起来，并声明它的路由、状态与恢复方式。浏览器侧 6 个页面共用同一个注入宿主（开发服务器渲染的站点页面），终端侧 7 个页面共用 stdout/stderr 两个通道；13 个页面之外还有 3 个**编辑器表面**，它们没有自有页面（详见 27.4）。页面状态一律由 [20 章](/design/states/) 的状态模型派生，本页只引用不新增。

### 27.1 Inventory

| 页面组件 | 页面 ID | 路由 / 触发命令 | 主要组件 | 所在产品端 |
| --- | --- | --- | --- | --- |
| `CliHelpPage` | P-T01 | `astro --help`、`astro <cmd> --help`、`astro --version` | `CliTable`、`CliStatus` | terminal |
| `CliDevPage` | P-T02 | `astro dev`（含 `--background/stop/status/logs`） | `CliStatus`、`CliSpinner`（拟议）、`CliTable` | terminal |
| `CliBuildPage` | P-T03 | `astro build` | `BuildReport`、`CliStatus` | terminal |
| `CliCheckPage` | P-T04 | `astro check` | `CheckReport`、`DiagnosticTable` | terminal |
| `CliAddPage` | P-T05 | `astro add [integration…]` | `AddIntegrationFlow`、`CliPrompt` | terminal |
| `CliInfoPage` | P-T06 | `astro info [--copy]` | `DebugInfoPanel` | terminal |
| `ScaffoldPage` | P-T07 | `npm create astro@latest` | `CliPrompt`、`CliStatus` | terminal |
| `ToolbarShellPage` | P-B01 | 任意开发页面 URL（工具栏注入，无自身路由） | `ToolbarAppBar`、`AppWindowFrame` | browser |
| `HomePage` | P-B02 | `localStorage` 开关，无 URL | `HomeApp`、`IntegrationPicker` | browser |
| `AuditPage` | P-B03 | 同上，无 URL | `AuditApp`、`AuditSummary` | browser |
| `InspectPage` | P-B04 | 同上，无 URL | `InspectApp`、`HighlightTooltipPair` | browser |
| `SettingsPage` | P-B05 | 无 URL；持久化键 `astro:dev-toolbar:settings` | `SettingsApp`、`SettingsGroup` | browser |
| `OverlayPage` | P-B06 | 出错页面本身（无独立 URL，`API-06` 注入） | `OverlayHeader`、`StackFrameList`、`OverlayCode` | browser |

### 27.2 Terminal Pages

#### 27.2.1 CliHelpPage

Props `commandName: string`（必填）· `payload: HelpPayload`（必填，含 `usage/headline/tables/description`）· `columns: number`（默认 `process.stdout.columns`）。组装 `CliTable` ×2（Commands / Global Flags）+ 版本徽标行；布局为反白版本行 → usage → 分节表 → 描述。
路由 `astro --help`、`astro <cmd> --help`、`astro --version`；状态不落盘。四态：加载不适用（同步打印）；空 = 无 `tables` 时省略表体；失败 = 未知命令走 `UnknownCLIError` 并退出 1；无权限不适用。转场无；重复执行即重印，无恢复状态。

```ts
showHelp({ commandName: 'astro', payload: DEFAULT_HELP_PAYLOAD, columns: process.stdout.columns });
```

#### 27.2.2 CliDevPage

Props `flags`（`port/host/open/background/force/mode`）· `urls: ResolvedServerUrls` · `startupTime: number`。组装 `serverStart` 块（`astro v7.4.5 ready in 123 ms` + `┃ Local` / `┃ Network`）+ 逐请求行 `[200] /path 12ms`；`--background` 时另有 `dev status/logs/stop` 子命令页。
路由即命令与参数（无 URL），后台态由锁文件寻址。四态：加载 = 启动块出现前只有空白，拟议 `CliSpinner`；空 = 尚无请求；失败 = 端口占用/配置校验失败（`[config]` 前缀 + 逐条 `!` 行）；无权限不适用。转场 = 启动块一次性覆盖、请求行追加；刷新 = 不恢复历史日志，`dev logs --follow` 从头/尾读锁文件。

```ts
print(serverStart({ startupTime, resolvedUrls, host, base, astroVersionProvider, textStyler }));
logger.info(null, req({ url, statusCode, method, reqTime }));
```

#### 27.2.3 CliBuildPage

Props `BuildRun`（`pageCount/duration/output/mode/adapter/error`）· `timings: boolean`。组装 `BuildReport`：`output:`/`mode:`/`adapter:` 三行 → `Collecting build info...` → 路由日志 → `<n> page(s) built in <t>` → `Complete!`。
路由 `astro build [--outDir --mode --devOutput --force --timings]`，无 URL。四态：加载 = 收集行 + 逐路由行；空 = 0 页面仍打印 `0 page(s) built in`；失败 = 错误码渲染 + 非 0 退出；无权限不适用。转场 = 追加式，不重绘上方；刷新 = 重跑全量（`--force` 清缓存），不做断点恢复。

```ts
await buildReport.run({ timings, devOutput }, (line) => logger.info('build', line));
```

#### 27.2.4 CliCheckPage

Props `CheckReport`（`diagnostics/clean/missingDeps/unsupportedTs`）· `watch: boolean`。组装 `Getting diagnostics for Astro files in <abs>...` 一行 + `DiagnosticTable`（文件:行:列 / 规则 / 级别）。
路由 `astro check [--watch --noSync]`。四态：加载 = 准备行（先 `sync`）；空 = 0 诊断（拟议 “No errors found.”）；失败 = 缺依赖原文或 TS7 不支持说明；无权限不适用。转场 = watch 模式下按文件覆盖重绘；刷新 = 重新执行并覆盖，不保留上次诊断。

```ts
const result = await check({ watch, noSync });
report.render(result); // 诊断走 DiagnosticTable，0 条走空态
```

#### 27.2.5 CliAddPage

Props `names: string[]` · `flags.yes`。组装 `IntegrationPicker`（多选）+ `AddIntegrationFlow`（安装 → 配置 diff → 脚手架提示）；无参数时退化为帮助页（UI/Docs 框架、SSR 适配器、Others 三张表）。
路由 `astro add react`、`astro add --yes tailwind`。四态：加载 = 安装 spinner；空 = 无参数 → 帮助表；失败 = 包不存在（校验即停）/ 安装器报错（保留原始输出）；无权限不适用。转场 = 提示逐条追加；刷新 = 不支持中途恢复，重跑会重新校验已装项。

```ts
if (!names.length) return showHelp({ commandName: 'astro add', tables: ADD_TABLES });
await addFlow.start({ names, yes: flags.yes });
```

#### 27.2.6 CliInfoPage

Props `debugInfo: [label, value | value[]][]` · `copy: boolean`。组装 `DebugInfoPanel`：标签加粗左对齐 25 字符、值绿色，多值续行缩进 25；随后静默写剪贴板。
路由 `astro info [--copy]`。四态：加载不适用（同步收集）；空 = 某段无值则整段省略；失败 = 剪贴板不可用（现状未捕获，拟议提示）；无权限不适用。转场无；重复执行重印，内容为同一快照。

```ts
logger.info('SKIP_FORMAT', formatter({ pretty: true }).format(debugInfo));
await clipboard.copy(formatter({ pretty: false }).format(debugInfo));
```

#### 27.2.7 ScaffoldPage

Props `ctx`（`projectName/template/installDeps/git/yes`）· `tasks`。组装 `CliPrompt` 多步向导（verify → intro → projectName → template → dependencies → git），收尾 `tasks` 进度（`Project initializing...` → `Project initialized!`）与 next steps（`Liftoff confirmed. Explore your project!`）。
路由 `npm create astro@latest [dir] -- --template <name> --yes`。四态：加载 = `Launch sequence initiated.`；空 = 目录已存在且为空时给出默认名提示；失败 = 中止打印 `Launch sequence aborted.`；无权限不适用。转场 = 每步清屏重绘（`clear: true`）；刷新 = 重跑从头开始，不保留已填答案。

```ts
banner();
for (const step of [verify, intro, projectName, template, dependencies, git]) await step(ctx);
await tasks({ start: 'Project initializing...', end: 'Project initialized!' }, ctx.tasks);
```

### 27.3 Browser Pages

#### 27.3.1 ToolbarShellPage

Props `apps: DevToolbarApp[]`（必填）· `settings: DevToolbarSettings`（必填）· `placement`（默认取设置）。组装 `ToolbarAppBar` + 每个 app 一个 `astro-dev-toolbar-app-canvas`（Shadow DOM）+ 各 `AppWindowFrame`。
路由 = 站点当前 URL，工具栏无自身路由（不写 URL 的理由：它是全局常驻外壳，不应产生历史记录）。四态：加载 = bar 立即出现，app 在 `requestIdleCallback` 后初始化，未 ready 点击无效；空 = 无自定义应用时不渲染分隔符与 More；失败 = 单 app 初始化失败 → 红色不可点 + tooltip `Error initializing …`，整体注入失败则无工具栏（站点不受影响）；无权限不适用。转场 = `view-transition-name: astro-dev-toolbar` 且显式关闭新旧动画；`astro:after-swap` 重新挂载。刷新恢复 = placement 与通知开关来自 `localStorage`，激活的 app 不恢复（瞬态）。

```tsx
<ToolbarShell apps={apps} settings={settings} placement={settings.placement} onEscape={closeTopmost} />
```

#### 27.3.2 HomePage

Props `metadata`（`version/latestAstroVersion/debugInfo/root`）· `integrations`（缓存）。组装 `HomeApp` → `AppWindowFrame`（标题 “Menu”、动作 “Copy debug info”）+ 徽标行 + 集成卡片横滑 + 四个外链。
路由无 URL（瞬态面板）。四态：加载 = 5 个骨架卡；空 = 集成数组为空（拟议文案）；失败 = 请求失败（现状骨架常驻，缺陷）；无权限不适用。转场 = 窗口硬切（拟议 150ms 淡入）；刷新 = 关面板即丢弃视图状态，集成数据在会话内缓存复用。

```tsx
<HomePage metadata={meta} integrations={cache} onCopyDebug={() => copy('```\n' + meta.debugInfo + '\n```')} />
```

#### 27.3.3 AuditPage

Props `audits: Audit[]` · `counts: Record<'a11y'|'perf', number>` · `state`。组装 `AuditApp` → `AuditSummary`（计数徽标 + 吸顶分类头 + 条目）+ `HighlightTooltipPair` 覆盖层。
路由无 URL。四态：加载 = 扫描中（拟议提示）；空 = `No accessibility or performance issues detected.`；失败 = 单规则 `match()` 异常仅跳过该元素并记日志，不进入失败页；无权限不适用。转场 = 条目展开用 `active` 切换（无动画）；刷新 = DOM 变更后自动重跑，页面刷新后重新扫描。

```tsx
<AuditPage audits={audits} counts={countByCategory(audits)} onRerun={rerun} />
```

#### 27.3.4 InspectPage

Props `islands: IslandMeta[]`（`client/props/componentUrl/rect`）· `state`。组装 `InspectApp` → `HighlightTooltipPair` 逐岛；空态走 `AppWindowFrame` 单段文案。
路由无 URL。四态：加载 = 页面加载后重建（无提示）；空 = `No islands detected.`；失败 = `props` 解析异常（现状中断，拟议逐岛降级）；无权限不适用。转场 = 高亮随滚动/resize 即时重定位，无动画；刷新 = `astro:after-swap` 重建、`astro:page-load` 重算位置。

```tsx
<InspectPage islands={islands} onOpenFile={(p) => openInEditor(root + p.slice(1))} />
```

#### 27.3.5 SettingsPage

Props `values: DevToolbarSettings` · `placements: Placement[]`。组装 `SettingsApp` → `SettingsGroup`（三条设置 + “Hide toolbar” 说明行）。
路由无 URL，**状态持久化到 `localStorage["astro:dev-toolbar:settings"]`**；不写 URL 的理由：属开发者本机偏好，应跨页面、跨刷新、跨项目域名保持，且不应污染站点可分享链接。四态：加载 = 无（同步读）；空 = 不适用（三项恒在）；失败 = 写入失败（拟议降级为内存态 + 提示）；无权限不适用。转场 = 无；刷新 = 从 localStorage 恢复，配置项 `placement` 作为二级默认值。

```tsx
<SettingsPage values={settings.config} onChange={(k, v) => settings.updateSetting(k, v)} />
```

#### 27.3.6 OverlayPage

Props `payload: AstroErrorPayload['err']`（`name/title/message/hint/docslink/loc/highlightedCode/stack/cause`）· `theme: 'light'|'dark'`。组装 `OverlayHeader` + 消息/提示区 + `OverlayCode` + `StackFrameList` + `OverlayAction`。
路由 = 出错页面自身，无独立 URL；载荷由 `API-06`（开发期错误载荷）随 HMR 推送。四态：加载不适用（同步构造）；空 = `message` 缺失时该区为空（拟议占位）；失败 = 无 `stack` 时栈体为空、无 `loc` 时隐藏代码块；无权限不适用。转场 = 直接插入覆盖（拟议 150ms 淡入）；刷新 = 错误重放则重绘，主题从 `astroErrorOverlayTheme` 恢复，其余不恢复。

```tsx
<OverlayPage payload={err} theme={readTheme()} onToggleTheme={toggleTheme} onCopyStack={() => copy(err.stack)} />
```

### 27.4 Editor Surfaces

三个表面由 VS Code 拥有，Astro 只提供数据契约，**不实现自绘界面**，因此无 Props、无布局、无转场（依据：`packages/language-tools/vscode` 只通过 `vscode` API 贡献能力，未提供 Webview 页面）。映射关系如下，标注“拟议”的部分需编辑器侧配合。

| 表面 | 数据来源 | 契约 | 状态归属 |
| --- | --- | --- | --- |
| S-E01 诊断列表 | 语言服务器 `publishDiagnostics` | `Diagnostic` 的 `file/line/column/severity/message` 一一映射到 Problems 面板，URI 用 `file://` 绝对路径 | VS Code 负责空态/失败态与分组 |
| S-E02 命令面板 | `astro.findFileReferences`、`astro.reloadProjects`、`astro.openTsConfig`、`astro.selectTypescriptVersion` | 命令 id 固定、参数为当前文档 URI；不可用时置灰而非隐藏（拟议） | VS Code |
| S-E03 状态栏 | 语言服务器状态 + TS 版本/配置项 | 两个状态项（`astro` 前缀），文案分别为 TS 版本与 tsconfig 状态；点击分别触发 `astro.selectTypescriptVersion` / `astro.openTsConfig` | VS Code |

### 27.5 Acceptance

| ID | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-27-01 | 360px 视口 | 依次打开 4 个面板 | 无横向滚动，面板内容不被裁切，关闭后焦点回按钮 |
| A-27-02 | 修改 placement 后刷新页面 | 观察工具栏 | 位置保持（localStorage 恢复），激活面板为关闭态 |
| A-27-03 | 页面无岛屿 | 打开 Inspect | 显示 `No islands detected.` 与客户端指令提示，无空窗口 |
| A-27-04 | 终端 0 页面项目 | `astro build` | 输出 `0 page(s) built in …` 与 `Complete!` |
| A-27-05 | 缺 `@astrojs/check` | `astro check` | 输出缺依赖原文，退出码非 0 |
| A-27-06 | 触发编译错误 | 关闭覆盖层后再刷新 | 错误重现；主题与上次选择一致 |
