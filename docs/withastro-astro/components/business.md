---
title: 业务组件
description: "业务组件把“数据从哪来、状态怎么变、失败怎么办”封装起来。开发期界面没有用户账号体系，业务数据的来源只有三类：页面 DOM（审计规则、岛屿元数据）、Vite HMR 通道（API-04 开发工具栏通道、API-05 HMR 通道，事件名形如 astro-dev-toolbar:<appId>:toggled、astro:devtoolbar:error:init）、Node 进程内的构建/检查结果（终端侧）。因此本章所有“无权限”态统一记为不适用，依据是 18 章权限模型只覆盖服务端接口（API-01/API-02/API-03），本地开发服务器默认仅绑定 loopback；能力缺失（剪贴板被拒、编辑器接口不可达）按“失败”态处理，不伪造权限错误"
sidebar:
  order: 26
  label: 业务组件
draft: false
lastUpdated: 2026-11-04
---

## 26. Business Components

业务组件把“数据从哪来、状态怎么变、失败怎么办”封装起来。开发期界面没有用户账号体系，业务数据的来源只有三类：**页面 DOM**（审计规则、岛屿元数据）、**Vite HMR 通道**（`API-04` 开发工具栏通道、`API-05` HMR 通道，事件名形如 `astro-dev-toolbar:<appId>:toggled`、`astro:devtoolbar:error:init`）、**Node 进程内的构建/检查结果**（终端侧）。因此本章所有“无权限”态统一记为**不适用**，依据是 18 章权限模型只覆盖服务端接口（`API-01`/`API-02`/`API-03`），本地开发服务器默认仅绑定 loopback；能力缺失（剪贴板被拒、编辑器接口不可达）按“失败”态处理，不伪造权限错误。

### 26.1 Inventory

| 组件 | 层级 | 用途 | 所在页面 | 数据来源 |
| --- | --- | --- | --- | --- |
| `HomeApp` | 业务 | 版本信息、调试信息复制、集成推荐与四个外链 | P-B02 | `window.__astro_dev_toolbar__` 元数据 + `https://astro.build/api/v1/dev-overlay/` |
| `AuditApp` | 业务 | 按规则扫描 DOM，列出无障碍/性能问题并高亮 | P-B03 | 页面 DOM + `apps/audit/rules/*` + `API-04` |
| `InspectApp` | 业务 | 标出岛屿、展示客户端指令与 props、跳转源码 | P-B04 | `astro-island` 元素属性 + `/__open-in-editor` |
| `SettingsApp` | 业务 | 三个开发者偏好，即时生效并持久化 | P-B05 | `localStorage["astro:dev-toolbar:settings"]` + `__astro_dev_toolbar__.placement` |
| `BuildReport` | 业务 | 构建摘要与耗时、失败原因 | P-T03 | `BuildRun` 结果 + `logger('build')` |
| `CheckReport` | 业务 | 类型/诊断报告与环境前置检查 | P-T04 | `@astrojs/check` 诊断 + 包可用性 |
| `AddIntegrationFlow` | 业务 | 集成/适配器安装、配置改写、脚手架提示 | P-T05 | npm registry + `ProjectConfig` 文件 |
| `DebugInfoPanel` | 业务 | 环境信息收集与复制（`astro info` 与菜单共用一份格式） | P-B02、P-T06 | `debugInfo` 字符串（`dev-debug-info-provider` / `cli-debug-info-provider`） |

### 26.2 HomeApp

**数据**：初始化时读 `window.__astro_dev_toolbar__` 的 `version`、`latestAstroVersion`、`debugInfo`、`root`、`placement`；打开面板且缓存为空时才请求集成数据，成功后写模块级 `integrationData` 并重建列表。**状态**：加载中显示 5 个骨架卡（2s 循环 + 每卡 250ms 错峰）；成功渲染卡片（名称、圆形 logo、描述截断 90 字）；空态（接口返回空数组）现状为一片空白，拟议补 “No featured integrations.”；失败（离线、接口 5xx、CORS）现状**静默保留骨架屏**，属缺陷，拟议显示 “无法加载集成列表” + 重试；提交中不适用（无写操作）；无权限不适用（公共只读接口）。**重复与竞态**：`integrationData` 只缓存首次结果，重开面板不重复请求；`astro:after-swap` 重建 DOM 时若缓存已存在则直接渲染，避免重复网络请求；复制按钮 3.5s 后复位，连续点击重置计时。

```tsx
function HomeApp() {
  const { version, latestAstroVersion, debugInfo } = useDevToolbarMetadata();
  const integrations = useIntegrations(); // 缓存优先，失败时可重试（拟议）
  return (
    <AppWindowFrame title="Menu" actions={<CopyDebugInfo debugInfo={debugInfo} resetMs={3500} />}>
      <VersionBadges version={version} latest={latestAstroVersion} />
      <IntegrationPicker mode="readonly" items={integrations.data} state={integrations.state} />
    </AppWindowFrame>
  );
}
```

### 26.3 AuditApp

**数据**：对 `document` 按每条规则的 `selector` 取元素（同一选择器走 `Map` 缓存），再用可选的 `match()` 二次判定；命中后记录 `{ auditedElement, rule, highlight, card }`。审计结果**不写回页面**，只增删 Shadow DOM 内的覆盖层。**状态**：首次运行（无进度指示，拟议给 200ms 延迟后的 “Scanning page…”）；有结果（分类计数 + 列表）；空态 “No accessibility or performance issues detected.”；部分失败（单条 `match()` 抛错只记日志并跳过该元素，不中断整轮）；提交中/无权限不适用（只读本地 DOM）。**重复与竞态**：DOM 变更用 250ms 防抖 + `requestIdleCallback({ timeout: 300 })`（Safari 回退 150ms）串行重跑；重跑前清空旧高亮与旧卡片，避免重复项；同一元素已有审计时跳过（源码注释承认这是简化实现）；`astro:before-preparation` 断开 observer、`astro:after-swap` 重跑、`astro:page-load` 后延迟 100ms 重新 observe（规避 View Transitions 追加的路由播报器）。

```tsx
const { audits, state, rerun } = useAudit({ rules, debounceMs: 250 });
return (
  <AuditSummary
    counts={countByCategory(audits)}
    items={audits}
    empty={state === 'empty' ? <EmptyState copy="No accessibility or performance issues detected." /> : null}
    onSelect={(a) => a.highlight.scrollIntoView()}
  />
);
```

### 26.4 InspectApp

**数据**：`document.querySelectorAll('astro-island')`，逐个读 `client`（客户端指令）、`props`（JSON 字符串）、`component-url`（模块路径），并为可见元素建立高亮。**状态**：有岛屿（高亮 + 提示：`client:load` / Props `pre` / 路径点击跳编辑器）；无岛屿 → “No islands detected.” + 客户端指令提示；隐藏或无布局的岛屿（`offsetParent === null` 或 `display:none`）静默跳过；`props` JSON 解析失败现状会抛错中断该轮（缺陷，拟议按元素降级为 “Props 无法解析”）；提交中/无权限不适用。**重复与竞态**：每次重建先 `remove()` 全部旧高亮再追加；`scroll`/`resize` 只重算位置不重建；`astro:after-swap` 重建、`astro:page-load` 刷新位置；跳转编辑器用绝对路径 + `encodeURIComponent`，避免 Vite 静默失败。

```tsx
<HighlightTooltipPair
  anchors={islands.map((el) => ({ rect: el.getBoundingClientRect(), meta: readIslandMeta(el) }))}
  empty={<EmptyState title="No islands detected." hint="Did you forget to add a client directive?" />}
  onOpenFile={(path) => fetch(`/__open-in-editor?file=${encodeURIComponent(root + path.slice(1))}`)}
/>
```

### 26.5 SettingsApp

**数据**：`settings.config`（`disableAppNotification`、`verbose`、`placement`），优先级为硬编码默认值 → `__astro_dev_toolbar__.placement`（配置项）→ `localStorage["astro:dev-toolbar:settings"]`。**状态**：已保存（现状仅在 verbose 时打印一行 console，拟议补可见 “已保存” 状态）；非法 placement 被 `isValidPlacement` 拒绝并写 error 日志（不崩溃）；存储失败（隐私模式/配额）现状未捕获，拟议降级为内存态 + 提示 “本次会话有效”；提交中不适用（同步写）；无权限不适用（本机开发者偏好，无账号体系）。**重复与竞态**：三个设置项互相独立、幂等，重复点击只覆盖同键；`placement` 变更同时广播 `placement-updated` 给所有 app（含 More 下拉），保证窗口与工具栏同步；`astro:after-swap` 重建窗口后从 `settings.config` 重新取值，避免与 localStorage 漂移。

```tsx
<SettingsGroup
  values={settings.config}
  rows={[
    { key: 'disableAppNotification', label: 'Disable notifications', hint: 'Hide notification badges in the toolbar.' },
    { key: 'verbose', label: 'Verbose logging', hint: 'Logs dev toolbar events in the browser console.' },
    { key: 'placement', label: 'Placement', input: 'select', options: placements },
  ]}
  onChange={(key, value) => { apply(key, value); settings.updateSetting(key, value); }}
/>
```

### 26.6 BuildReport

**数据**：`BuildRun` 的产物（页数、总耗时、`output`/`mode`/`adapter`）由 `logger('build')` 逐行输出，末两行为 `<n> page(s) built in <time>` 与 `Complete!`；静态路由汇总另有一行反白的 `built static routes`。**状态**：收集中（`Collecting build info...`）、构建中（逐路由/逐 chunk 行）、成功（摘要 + `Complete!`）、失败（错误交给 19 章错误码渲染，退出码非 0）、空（0 个页面：仍输出 `0 page(s) built in`，拟议补 “未发现可构建页面” 提示）、无权限不适用（本地写盘）。**重复与竞态**：`--force` 清缓存后全量重建；增量构建会打印 `Pruned <n> stale file(s) from the incremental cache.`；单进程串行，无并发写；`--timings` 追加耗时表而非替换摘要。

```ts
const run = await build({ devOutput, timings });
report.summary({
  pages: run.pageCount, totalMs: run.durationMs, output: run.output, mode: run.mode, adapter: run.adapter,
});
report.fail(run.error); // 交由 A-19 错误码渲染
```

### 26.7 CheckReport

**数据**：先跑 `sync` 生成类型，再调用 `@astrojs/check` 的诊断；前置检查 `typescript` 与 `@astrojs/check` 是否可解析。**状态**：准备中（`Getting diagnostics for Astro files in <abs path>...`）、有诊断（按文件分组）、干净（0 诊断，拟议输出 “No errors found.”）、失败-缺依赖（真实文案：`The @astrojs/check and typescript packages are required for this command to work. Please manually install them into your project and try again.`）、失败-版本不支持（TypeScript ≥7 时输出不支持说明并返回，提示改用 `@astrojs/ts-content-mapper`）；无权限不适用。**重复与竞态**：`--watch` 与 `astro dev` 并行时 `sync` 只跑一次（源码注释明确）；诊断按文件覆盖写，不做增量合并，避免残留旧错误。

```ts
const ok = await check({ watch, noSync });
report.state(ok ? 'clean' : 'diagnostics'); // 诊断行交给 DiagnosticTable
```

### 26.8 AddIntegrationFlow

**数据**：registry 版本（`fetchPackageVersions`，供 `findMaxSatisfying` 选版）、`package.json` 与 `astro.config.*`（用 magicast 读写并产出 diff）、安装器（npm/pnpm/yarn/bun 自动探测）。**状态**：选择（无参数时列分类帮助并退出）、确认（写配置前展示 diff）、安装中（`CliSpinner` / clack 进度）、成功（配置已改 + next steps）、已中止（`Ctrl+C` 退出；现状无专门中止文案，拟议复用脚手架的 `Launch sequence aborted.`）、失败-包不存在（校验失败即停）、失败-安装器报错（保留原始输出 + 重试建议）、失败-需手写（`wrangler.jsonc` 等脚手架会先提示 “Astro will scaffold ./wrangler.jsonc.”）；无权限不适用（本地文件系统）。**重复与竞态**：同名集成已存在时跳过安装但仍补配置；`--yes` 全自动、失败即非 0 退出；配置写入用临时文件 + 重命名的原子替换（拟议；现状直接写），避免中断留下半截配置；pnpm 11 的 build-script 审批会以 `pendingBuilds` 阻塞，需提示用户确认。

```ts
const flow = await add({ names, yes });
flow.on('install', () => spinner.start('Installing…'));
flow.on('config', (diff) => confirm(diff) && flow.apply());
flow.on('abort', () => msg.cancelled('Launch sequence aborted.')); // 拟议：复用脚手架措辞，现状无该文案
```

### 26.9 DebugInfoPanel

**数据**：浏览器侧直接读注入的 `debugInfo` 字符串（含版本、Node、包管理器、操作系统、适配器、集成），复制时包一层 ``` 代码围栏；终端侧由 `debugInfoProvider.get()` 返回 `[label, value|value[]]` 列表，按 25 字符左对齐、绿色值输出，并**同时**写入剪贴板（`--copy` 强制复制）。**状态**：复制成功（菜单按钮变 “Copied to clipboard!”，3.5s 复原；`astro info` 无文案，直接已复制）、复制失败（剪贴板 API 拒绝/无 DISPLAY，现状未捕获 → 拟议提示 “复制失败，请手动选择文本” 并保留可见输出）、空（无集成时省略该分段）、提交中不适用（同步读快照）、无权限不适用。**重复与竞态**：复制是幂等覆盖，连续点击重置计时器；`astro info` 的“打印 + 复制”两次格式化必须使用同一份快照，避免中途环境变化导致两份内容不一致。

```tsx
<DebugInfoPanel
  format="markdown"        // 浏览器：代码围栏；终端：pretty 对齐
  value={debugInfo}
  onCopied={() => setLabel('Copied to clipboard!')}
  onCopyError={() => setLabel('复制失败，请手动选择文本')}  // 拟议
/>
```

### 26.10 Acceptance

| ID | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-26-01 | 断网 | 打开 Menu | 现状骨架屏不消失（缺陷记录）；修复后出现失败提示与重试 |
| A-26-02 | 页面含 2 个岛屿、其一 `display:none` | 打开 Inspect | 只高亮 1 个；提示含 `client:*` 与 props |
| A-26-03 | 手工写入非法 placement | 打开 Settings | 工具栏位置不变，控制台有 `Invalid placement` 错误 |
| A-26-04 | 构建 0 页面项目 | `astro build` | 输出 `0 page(s) built in …` 与 `Complete!`，退出码 0 |
| A-26-05 | 未装 `@astrojs/check` | `astro check` | 输出缺依赖原文并退出非 0 |
| A-26-06 | 含图片缺 `alt` 的页面 | 打开 Audit | 列表出现对应规则；修复后重跑列表清空并显示空态 |
| A-26-07 | 连续点击复制调试信息 3 次 | 观察按钮 | 文案保持已复制，复位时间从最后一次点击起算 |
