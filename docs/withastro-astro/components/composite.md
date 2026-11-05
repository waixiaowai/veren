---
title: 复合组件
description: "复合组件由基础组件拼装而成，只负责布局、插槽与交互编排，不引入新的视觉语言，也不直接读写业务数据（数据由 26 章(/design/components/business/#26-business-components) 的业务组件注入）。九个复合组件中，六个属浏览器开发界面（P-B01–P-B06），两个属终端（P-T01–P-T07），一个跨端共享同一份“可选集成清单”数据形状"
sidebar:
  order: 25
  label: 复合组件
draft: false
lastUpdated: 2026-11-04
---

## 25. Composite Components

复合组件由基础组件拼装而成，只负责**布局、插槽与交互编排**，不引入新的视觉语言，也不直接读写业务数据（数据由 [26 章](/design/components/business/#26-business-components) 的业务组件注入）。九个复合组件中，六个属浏览器开发界面（P-B01–P-B06），两个属终端（P-T01–P-T07），一个跨端共享同一份“可选集成清单”数据形状。

### 25.1 Inventory

| 组件 | 组成的基础组件 | 层级 | 用途 | 所在页面 |
| --- | --- | --- | --- | --- |
| `ToolbarAppBar` | `ToolbarBar`、`ToolbarButton`、`ToolbarIcon`、`ToolbarBadge` | 复合 | 编排内置/自定义应用按钮、分隔符、通知点与 Settings 尾位 | P-B01 |
| `AppWindowFrame` | `ToolbarWindow`、`ToolbarIcon`、`OverlayAction`（拟议箭头） | 复合 | 窗口骨架：标题栏、动作区、内容槽、位置同步、外点关闭 | P-B02–P-B05 |
| `HighlightTooltipPair` | `ToolbarHighlight`、`ToolbarTooltip` | 复合 | 高亮块与提示成对定位、滚动/缩放跟随、点击跳文件 | P-B03、P-B04 |
| `OverlayHeader` | `ToolbarIcon`（复用图标）、`OverlayThemeToggle` | 复合 | 错误名 + 标题 + Houston 插画 + 主题开关 | P-B06 |
| `StackFrameList` | `OverlayCode`（同源代码块样式）、`OverlayCopyButton` | 复合 | 栈标题栏 + 复制 + 等宽栈体 + 原因区 | P-B06 |
| `SettingsGroup` | `ToolbarToggle`、`ToolbarSelect`、`ToolbarRadioCheckbox`（拟议） | 复合 | 一行设置 = 标题 + 描述 + 控件，行间 `hr` | P-B05 |
| `AuditSummary` | `ToolbarBadge`、`ToolbarIcon` | 复合 | 分类计数徽标 + 分类吸顶表头 + 返回列表 | P-B03 |
| `DiagnosticTable` | `CliTable` | 复合 | 诊断列表（文件:行:列 / 规则 / 级别）对齐输出 | P-T04 |
| `IntegrationPicker` | `CliPrompt`、`ToolbarCard`（浏览器侧只读卡片） | 复合 | 集成多选（终端）与只读展示（菜单） | P-T05、P-B02 |

### 25.2 ToolbarAppBar

**布局**：单行 flex，不换行、不滚动。顺序固定为「内置应用（除 `astro:settings`、`astro:more`）→ 分隔符 → 自定义应用前 3 个 → More（自定义 >3 时）→ 分隔符 → Settings」。条目宽 44px（首尾 42px + 4px 内缩），高 40px，圆角由 `ToolbarBar` 两端裁切。**插槽**：无插槽，条目由 `apps: DevToolbarApp[]` 数据驱动（`id/name/icon/active/status/notification`）。**响应式**：条目不伸缩，360px 下 5 个条目 + 2 条分隔符 ≈ 224px，仍居中可用；应用数上限由 `customAppsToShow = 3` 决定（源码注释标注“应随屏宽动态化”，待确认）。**交互**：点击切换应用（先关旧、再开新；旧应用 `beforeTogglingOff` 返回 `false` 则中止）；`status !== 'ready'` 时点击无效；初始化失败置 `data-app-error`、tooltip 改 `Error initializing ${name}`、hover 变红且 `cursor: not-allowed`；通知点按 `error/warning/info` 三色 10×10 圆点/三角/方块，位于图标右上 `-4/-6`。

```tsx
<ToolbarAppBar
  placement={settings.placement}
  hidden={hidden}
  items={apps}
  noNotification={settings.disableAppNotification}
  onToggle={(id) => toggleApp(id)}
/>
```

### 25.3 AppWindowFrame

**布局**：`ToolbarWindow` 提供 640×480、圆角 12、padding 24、固定 `bottom:72px`；内部三段：标题（`h1` 22/600 + 前置图标）、动作区（右上角按钮，如 “Copy debug info”）、内容（可滚动）。**插槽**：`header`（标题）、`actions`（动作）、默认内容槽。**响应式**：≤640px 圆角归零并贴边；高度超限时整窗滚动（设置页）或内容区滚动（审计页 `overscroll-behavior: contain`）。**交互**：`placement` 变化时通过 `placement-updated` 事件同步（窗口自身不改位置）；点击工具栏外部关闭；`Esc` 关闭；打开时**不抢夺页面焦点**（现状），拟议改为聚焦窗口首个可聚焦元素并在关闭后归还。箭头：现状无，拟议在窗口底部中央加 8px 三角，随 `placement` 左右切换（对齐到触发按钮），仅装饰、`aria-hidden`。

```html
<astro-dev-toolbar-window placement="bottom-center" role="dialog" aria-modal="false">
  <header><h1><astro-dev-toolbar-icon icon="gear"></astro-dev-toolbar-icon> Settings</h1></header>
  <slot name="actions"><astro-dev-toolbar-button>Copy debug info</astro-dev-toolbar-button></slot>
  <slot />
</astro-dev-toolbar-window>
```

### 25.4 HighlightTooltipPair

**布局**：高亮层绝对定位覆盖目标元素矩形（`z-index: 2000000000`），提示层紧随其后（`2000000001`），默认在高亮下方，越界时翻到上方；角标固定在右上 `-15/-15`。**插槽**：提示内容为 `sections` 数据，不是插槽。**响应式**：提示 `min-width: 30ch`、`max-width: 45ch`，`pre` 区 `max-height: 250px` 内滚动；视口边缘由定位函数夹取。**交互**：`scroll`/`resize`/`astro:page-load` 刷新位置；对 `position: fixed` 的宿主元素改用 `fixed` 定位并只计算一次；鼠标进入高亮显示提示，离开隐藏；`focus` 高亮会滚动并激活对应审计卡片；可点击节显示 “Click to go to file” 并在点击时请求编辑器。

```tsx
<HighlightTooltipPair
  rect={element.getBoundingClientRect()}
  tone="warning"
  title={rule.title}
  sections={[{ content: rule.message }, { content: fileWithPosition }]}
  onOpenFile={() => openInEditor(fileWithPosition)}
/>
```

### 25.5 OverlayHeader

**布局**：`position: relative`，左侧纵向堆叠错误名（18/22，`--error-text`）与标题（34/41，600，`--title-text`），右上角主题开关（绝对定位，`right:3px`），右下角 Houston 插画（175×131，纯装饰，`aria-hidden`）与 175×250 渐变叠层（`z-index:-50/-25`）。**插槽**：无。**响应式**：≤1024px 隐藏插画与叠层；≤768px 收窄留白并把主题开关移到标题下方（`right:22px; margin-top:47px`）。**交互**：主题开关切换整页令牌组（见 23.10），状态写入 `localStorage`；标题与错误名不可选？现状可选，保留（开发者需要复制）。

```html
<header id="header">
  <section id="header-left"><h2 id="name">{err.name}</h2><h1 id="title">{err.title}</h1></section>
  <OverlayThemeToggle checked={isDark} />
  <div id="houston" aria-hidden="true">{houstonSvg}</div>
</header>
```

### 25.6 StackFrameList

**布局**：卡片（`--box-background`、圆角 4）内两段：标题栏（`h2` 22/600 + 右侧复制图标，底部分隔线）与栈体（14/21 等宽、`white-space: pre`、横向滚动、padding 24）。**插槽**：标题、动作、栈文本。**响应式**：栈不折行（保留缩进），超宽横向滚动；长路径以 `overflow-wrap: anywhere` 处理文件名行（仅代码块）。**交互**：复制按钮 2s 后复原；栈体可选中复制；`Cause` 区在有 `err.cause` 时追加显示（对象走 `JSON.stringify(…, null, 2)`）；`prefers-reduced-motion` 下无动画（本组件无过渡）。

```html
<StackFrameList title="Stack Trace" stack={err.stack} onCopy={() => copy(err.stack)} />
```

### 25.7 SettingsGroup

**布局**：每行 `<label class="setting-row">`：左侧文本区（`h3` 16/400 白色 + 14px 描述，`max-width: 67%`，整行说明用 `.full-width` 放开到 100%），右侧控件（开关/下拉）垂直居中；行间插入 `<hr>`（`1px solid rgba(27,30,36,1)`）。**插槽**：无（由 `SettingRow[]` 数据驱动：`name/description/input/settingKey/changeEvent`）。**响应式**：≤640px 时文本区降至 100%，控件换到下一行右对齐（拟议；现状在同一行挤压）。**交互**：控件变更即生效（无“保存”按钮），设置立刻写 `localStorage`，仅以 `verboseLog` 记录结果——拟议补一条可见的“已保存”提示（`role="status"`）与失败回滚。

```tsx
<SettingsGroup
  rows={rows}
  values={settings.config}
  onChange={(key, value) => { applyImmediately(key, value); settings.updateSetting(key, value); }}
/>
```

### 25.8 AuditSummary

**布局**：窗口头部左侧 `h1` “Audit”，右侧计数区：每个规则分类一个圆角徽标（图标 + 数字，padding `12px 8px`，字体 14）；`count === 0` 用 `green`，否则 `purple`。列表按分类分组，分类表头 `position: sticky; top: 0`、底色 `rgba(27,30,36,1)`、padding `10px 16px`。**插槽**：分类头内容（图标 + 名称）、条目槽。**响应式**：窗口固定 350×420，条目字号 14、selector 12 等宽并截断到 8 字符 + `…`。**交互**：点击条目展开详情（`active`）并滚动页面到高亮；展开时出现 “Back to list”（`arrow-left` 图标）返回；外点先取消 `active` 再关闭窗口；计数随重跑刷新。

```html
<AuditSummary
  counts={{ a11y: 3, perf: 0 }}
  groups={[{ code: 'a11y', name: 'Accessibility' }, { code: 'perf', name: 'Performance' }]}
  items={audits}
  onSelect={(audit) => audit.highlight.scrollIntoView()}
/>
```

### 25.9 DiagnosticTable

**布局**：终端表格，三列 —— 位置（`file:line:column`，右对齐、超长从左侧省略）、规则/代码（等宽）、级别（`error`/`warning`/`hint`，按色阶）；表头 `Diagnostics` 用反白标签（`bgWhite(black(' … '))`），行间无空行以便复制。**插槽**：无（终端无插槽概念，数据即接口）。**响应式**：`stdout.columns < 60` 时每条拆两行（位置一行、说明缩进两格），不做横向截断；CJK 按显示宽度补空格（拟议）。**交互**：`--watch` 下增量重绘（清屏重印，不做原地刷新）；`--json` 时整表改为 JSON 行日志，不渲染表格。说明：`astro check` 的诊断输出当前由 `@astrojs/check` 负责，本组件为**拟议**的统一渲染层（依据：astro 核心只输出 “Getting diagnostics for Astro files in …” 一行）。

```ts
const rows = diagnostics.map((d) => [`${rel(d.file)}:${d.line}:${d.col}`, d.code, d.level]);
msg.printTable({ title: 'Diagnostics', rows, splitAt: 60 });
```

### 25.10 IntegrationPicker

**布局**：终端多选列表，每项一行“序号 + 名称 + 说明”，选中项前置标记并用 `cyan` 高亮，底部提示 “Space to select, Enter to confirm”；浏览器侧不复用选择交互，只在菜单窗口以 `ToolbarCard` 横排只读卡片（240×160、圆形 logo、标题、描述截断 90 字 + `…`）。**插槽**：终端无；浏览器侧卡片内容槽。**响应式**：终端列表随列宽折行（名称与说明分两行）；浏览器横滑区在窄屏保持 240px 卡片宽并显示左右渐隐遮罩。**交互**：`↑/↓` 移动、`Space` 选中、`Enter` 确认、`a` 全选、`Ctrl+C` 取消并输出 `Launch sequence aborted.`；`--yes` 跳过全部交互；已安装项置灰并从默认选中移除（拟议：现状仅按名称校验，重复安装会由包管理器报错）。

```ts
const picked = await picker.ask({
  message: 'Which integrations would you like to add?',
  options: integrations.map((i) => ({ value: i.name, label: i.name, hint: i.type })),
});
```

### 25.11 Acceptance

| ID | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-25-01 | 4 个自定义应用 | 观察工具栏 | 只显示前 3 个 + More 按钮；More 内列表带通知点 |
| A-25-02 | 打开两个窗口 | 在两个应用按钮间切换 | 旧窗口先关、新窗口后开；无两个窗口同时可见 |
| A-25-03 | 高亮目标在视口底部 | 悬停高亮 | 提示翻转到上方且不越出视口 |
| A-25-04 | 覆盖层有 `cause` | 打开覆盖层 | `Cause` 区出现，JSON 缩进 2 空格 |
| A-25-05 | 设置窗口 | 修改 Placement | 工具栏与窗口同时改变位置，无闪跳 |
| A-25-06 | 终端 50 列 | `astro check` | 诊断拆两行，路径不被硬截断 |
