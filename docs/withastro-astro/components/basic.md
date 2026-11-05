---
title: 基础组件
description: "基础组件是不可再分的视觉与交互原子，全部落在浏览器开发界面（15 个）与终端输出（4 个）两侧。浏览器侧一律是自定义元素（Web Component），宿主标签名与源码 customElements.define 一致，样式封闭在 Shadow DOM 内，因此只允许通过属性/property 传参，不得由外部 CSS 覆盖内部样式；终端侧不是 DOM 组件，而是“可复用的输出块”，以函数返回值（字符串）为接口，颜色由 TextStyler 注入。所有尺寸与颜色只引用 23 章(/design/ui/#233-typography) 的令牌名"
sidebar:
  order: 24
  label: 基础组件
draft: false
lastUpdated: 2026-11-04
---

## 24. Basic Components

基础组件是不可再分的视觉与交互原子，全部落在浏览器开发界面（15 个）与终端输出（4 个）两侧。浏览器侧一律是自定义元素（Web Component），宿主标签名与源码 `customElements.define` 一致，样式封闭在 Shadow DOM 内，因此**只允许通过属性/property 传参，不得由外部 CSS 覆盖内部样式**；终端侧不是 DOM 组件，而是“可复用的输出块”，以函数返回值（字符串）为接口，颜色由 `TextStyler` 注入。所有尺寸与颜色只引用 [23 章](/design/ui/#233-typography) 的令牌名。

### 24.1 Inventory

| 组件 | 宿主标签 / 形态 | 层级 | 用途 | 所在页面 | 实现状态 |
| --- | --- | --- | --- | --- | --- |
| `ToolbarBar` | `astro-dev-toolbar` 内 `#dev-bar` | 原子 | 40px 圆角胶囊容器，承载应用按钮 | P-B01 | 已实现 |
| `ToolbarIcon` | `astro-dev-toolbar-icon` | 原子 | 渲染 20/24px 内联 SVG 或插槽自定义图标 | P-B01–P-B05 | 已实现 |
| `ToolbarButton` | `astro-dev-toolbar-button` | 原子 | 带 8 种配色/3 种尺寸的按钮 | P-B02、P-B03 | 已实现 |
| `ToolbarBadge` | `astro-dev-toolbar-badge` | 原子 | 12px 等宽徽标（版本号、计数） | P-B02、P-B03 | 已实现 |
| `ToolbarCard` | `astro-dev-toolbar-card` | 原子 | 可点击/可跳转的卡片容器 | P-B02 | 已实现 |
| `ToolbarToggle` | `astro-dev-toolbar-toggle` | 原子 | 32×20 开关（复选框语义） | P-B05 | 已实现 |
| `ToolbarSelect` | `astro-dev-toolbar-select` | 原子 | 下拉选择，包装原生 `<select>` | P-B05 | 已实现 |
| `ToolbarRadioCheckbox` | `astro-dev-toolbar-radio-checkbox` | 原子 | 16px 单选圆点 | P-B05（拟议） | 已实现，内置无调用点 |
| `ToolbarTooltip` | `astro-dev-toolbar-tooltip` | 原子 | 紫色浮层，分节展示指令/属性/文件 | P-B01、P-B03、P-B04 | 已实现 |
| `ToolbarWindow` | `astro-dev-toolbar-window` | 原子 | 640×480 弹出窗口骨架（含 placement） | P-B02–P-B05 | 已实现 |
| `ToolbarHighlight` | `astro-dev-toolbar-highlight` | 原子 | 页面元素描边高亮层 | P-B03、P-B04 | 已实现 |
| `OverlayCode` | `#code` 区块 | 原子 | 语法高亮代码块 + 文件名 + 光标行 | P-B06 | 已实现 |
| `OverlayCopyButton` | `#copy-btn` | 原子 | 复制栈，2s 对勾反馈 | P-B06 | 已实现（可访问性待改） |
| `OverlayThemeToggle` | `#theme-toggle-label` | 原子 | 66×30 双图标主题开关 | P-B06 | 已实现 |
| `OverlayAction` | `.link` 行 | 原子 | “See Docs Reference / Open in editor”动作 | P-B06 | 已实现 |
| `CliSpinner` | 函数，输出 ANSI 行 | 原子 | 长任务进行中的单行动画 | P-T03、P-T05 | 拟议抽象 |
| `CliStatus` | 函数，输出带底色的状态行 | 原子 | `success` / `action required` / `cancelled` 徽标行 | P-T01–P-T07 | 已实现（`msg.*`） |
| `CliTable` | 函数，输出对齐表格 | 原子 | 命令/参数帮助表 | P-T01、P-T04、P-T05、P-T06 | 已实现（`LoggerHelpDisplay`） |
| `CliPrompt` | 第三方 `@clack/prompts` 包装 | 原子 | 文本输入、单选、多选确认 | P-T05、P-T07 | 已实现（外部库，拟议薄封装） |

### 24.2 Toolbar Atoms

| 组件 | Props（类型 / 必填 / 默认） | 状态 | 事件 |
| --- | --- | --- | --- |
| `ToolbarBar` | `placement: 'bottom-left'\|'bottom-center'\|'bottom-right'` / 否 / `bottom-center`；`hidden: boolean` / 否 / `true`；`noNotification: boolean` / 否 / `false` | hidden（条目 `opacity:.2`、下移 40px）、hover/focusin（立即展开）、focus-visible（`outline-offset:-3px`）、disabled（无） | `app-toggled`（由工具栏派发）、`placement-updated`、`Escape`（document 级） |
| `ToolbarIcon` | `icon: DefinedIcon \| string \| undefined` / 否 / `undefined`（未知值转为 `<slot>`）；尺寸由父级 CSS 决定（bar 20、卡片/提示 24、徽标内 1em） | 无交互状态；`forced-colors` 下白填充转黑 | 无 |
| `ToolbarButton` | `size: 'small'\|'medium'\|'large'` / 否 / `small`；`buttonStyle: 'ghost'\|'outline'\|'purple'\|'gray'\|'red'\|'green'\|'yellow'\|'blue'` / 否 / `purple`；`buttonBorderRadius: 'normal'\|'rounded'` / 否 / `normal`；`disabled`、`loading`（拟议） | hover（`cursor:pointer`，无底色变化）、focus（UA 环）、disabled/loading（拟议：`opacity:.5` + `aria-disabled`） | 原生 `click` 冒泡（跨 Shadow 边界需 `composed: true`）、`focus` |
| `ToolbarBadge` | `size: 'small'\|'large'` / 否 / `small`（20/24px 高）；`badgeStyle` 同上 6 色 / 否 / `purple`；内容走 slot | 无 | 无 |
| `ToolbarCard` | `link?: string` / 否 / 空（有值渲染 `<a target="_blank">`）；`clickAction?: () => void \| Promise<void>` / 否 / 空（有值渲染 `<button>`）；`cardStyle` / 否 / `purple` | hover（`--hover-background` + `--hover-border`）、focus（UA）、disabled（无） | `click`（`clickAction` 或跳转） |

```html
<!-- 组合伪代码：只表达调用关系，不含实现 -->
<astro-dev-toolbar-bar placement={settings.placement} hidden={isHidden}>
  <astro-dev-toolbar-button button-style="ghost" size="medium" aria-label="Audit">
    <astro-dev-toolbar-icon icon="astro:logo" />
  </astro-dev-toolbar-button>
  <astro-dev-toolbar-badge badge-style="gray" size="large">{version}</astro-dev-toolbar-badge>
</astro-dev-toolbar-bar>
```

### 24.3 Form Atoms

| 组件 | Props（类型 / 必填 / 默认） | 状态 | 事件 |
| --- | --- | --- | --- |
| `ToolbarToggle` | `toggleStyle: 'purple'\|'gray'\|'red'\|'green'\|'yellow'\|'blue'` / 否 / `gray`；`checked: boolean`（写内部 `input.checked`）/ 否 / `false`；`value: string` / 否 / 空；`name` 固定 `dev-toolbar-toggle` | checked（底色 + 滑块右移 12px）、hover（拟议）、focus（拟议 2px 环，现状无）、disabled（拟议，现状未接） | `change`（原生 `input` 事件） |
| `ToolbarSelect` | `selectStyle` 6 色 / 否 / `gray`；`value: string` / 否 / 首项；`disabled: boolean` / 否 / `false`；子节点 `<option>` 经 `slotchange` 搬入内部 `<select>` | hover、focus（UA）、disabled（原生置灰） | `change`（在 `.element` 上监听） |
| `ToolbarRadioCheckbox` | `radioStyle` 6 色 / 否 / `purple`；`checked` / 否 / `false`；`disabled` / 否 / `false`；`name: string` / 否 / `''`；`value: string` / 否 / `''` | checked（2px 环 + 8px 实心点）、disabled、focus（拟议） | `change` |

```html
<label class="setting-row">
  <section><h3>Disable notifications</h3>Hide notification badges in the toolbar.</section>
  <astro-dev-toolbar-toggle onchange={onToggleNotifications} />
</label>
```

### 24.4 Floating Atoms

| 组件 | Props（类型 / 必填 / 默认） | 状态 | 事件 |
| --- | --- | --- | --- |
| `ToolbarTooltip` | `sections: { title?, inlineTitle?, icon?, content?, clickAction?, clickDescription? }[]` / 是 / `[]`；显示由 `data-show="true"` 控制；`max-width: 45ch`、`min-width: 30ch` | 隐藏（`display:none`）、显示、可点击节（`background: #7118E2`，hover `cursor:pointer`） | 可点击节的 `click`（如 “Click to go to file” → `/__open-in-editor?file=`） |
| `ToolbarWindow` | `placement`（property 与 attribute 双入口，非法值写错误日志并忽略）/ 否 / `bottom-center`；内容走默认 slot；`role`、`aria-modal`（拟议） | 高 480 内滚动、≤640px 圆角归零、多窗口堆叠（`z-index: 999999999`） | 无内建事件；外点关闭由 app 的 `closeOnOutsideClick` 处理 |
| `ToolbarHighlight` | `icon?: Icon` / 否 / 空；`highlightStyle` 6 色 / 否 / `purple`（审计用 `warning`）；位置由 `positionHighlight(rect)` 写入 | 静态描边 + 右上角 24px 角标；hover/focus 触发联动（审计卡片高亮）；不设 `pointer-events: none`，会拦截覆盖区点击（拟议修正） | `mouseover`/`mouseout`/`focus`（由审计侧绑定） |

```js
// 组合伪代码：高亮 + 提示 + 定位
const highlight = createHighlight(rect, 'warning', { 'data-audit-code': rule.code });
const tooltip = document.createElement('astro-dev-toolbar-tooltip');
tooltip.sections = [{ icon: 'warning', title }, { content: message }];
attachTooltipToHighlight(highlight, tooltip, element);
```

### 24.5 Error Overlay Atoms

| 组件 | Props（类型 / 必填 / 默认） | 状态 | 事件 |
| --- | --- | --- | --- |
| `OverlayCode` | `fileLocation: string`（`file:line:column`，末两段）/ 是；`absoluteFileLocation: string`（`title` 提示）/ 是；`highlightedCode: string`（Shiki HTML）/ 是；`caretColumn?: number` / 否 / 空 | 可见（有 `loc.file`）、滚动到错误行、隐藏（无定位信息） | “Open in editor” → `fetch('/__open-in-editor?file=…')` |
| `OverlayCopyButton` | `text: string`（完整栈）/ 是；`resetMs: number` / 否 / `2000`；`copiedLabel`（拟议）/ 否 / 空 | idle → copied（对勾 + `--success-text`）→ idle；hover（`--accent-hover`）；focus/disabled（拟议，现状 `<span>` 不可聚焦） | `click` → `navigator.clipboard.writeText` |
| `OverlayThemeToggle` | `checked: boolean`（`localStorage.astroErrorOverlayTheme === 'dark'` 或系统偏好）/ 否 / 系统值；`label: string`（sr-only）/ 否 / `Use dark theme` | checked（球右移 28.5px）、focus（`outline:2px solid`，offset 4px）、forced-colors（球用 `SelectedItem`） | `change` → 切 `.astro-dark` + 回写 localStorage |
| `OverlayAction` | `kind: 'link'\|'button'` / 是；`label: string` / 是；`href?: string` / link 必填；`icon?: Icon`；`onActivate?: () => void \| Promise<void>` / button 必填 | hover（`--accent-hover` + 下划线）、focus（拟议 2px 环）、disabled（无） | `click`；按钮型不换页 |

```js
// 组合伪代码：动作行
overlay.createLink('See Docs Reference' + openNewWindowIcon, err.docslink);
overlay.createLink('Open in editor' + openNewWindowIcon, undefined).onclick = () =>
  fetch('/__open-in-editor?file=' + encodeURIComponent(absoluteFileLocation));
```

### 24.6 Terminal Atoms

| 组件 | Props（类型 / 必填 / 默认） | 状态 | 事件 |
| --- | --- | --- | --- |
| `CliSpinner` | `label: string` / 是；`active: boolean` / 否 / `true`；`stream: 'stdout'\|'stderr'` / 否 / `stdout` | active（单行覆写）、done（清行）、静默（`--silent`/`--json` 时禁用） | 无（受 `SIGINT` 中断） |
| `CliStatus` | `level: 'success'\|'action-required'\|'cancelled'\|'info'\|'warn'` / 是；`message: string` / 是；`tip?: string` / 否 / 空 | 单次输出；`--silent` 静默；非 TTY 去色 | 无 |
| `CliTable` | `title: string` / 是；`rows: [cmd: string, help: string][]` / 是；`padding?: number` / 否 / 自动取最大命令宽度 + 2；`splitAt?: number` / 否 / `60`（列宽阈值） | 宽表（对齐）、窄表（命令一行、说明缩进一行） | 无 |
| `CliPrompt` | `message: string` / 是；`options?: { value, label, hint? }[]` / 否 / 空；`initialValue?`；`required?: boolean` / 否 / `true`；`yes?: boolean`（`--yes` 跳过）/ 否 / `false` | idle、输入中、校验失败（重问）、取消（Ctrl+C → `cancelled`） | `submit`、`cancel` |

```ts
// 组合伪代码：状态行与帮助表
print(msg.success('Project initialized!', 'Run `astro dev` to start.'));   // ▶ 提示
print(msg.actionRequired('TypeScript 7 is not supported.'));               // 需要用户处理
help.show({ commandName: 'astro check', tables: { Flags }, description }); // 60 列自适应
```

### 24.7 Conventions

状态命名统一为 `default / hover / focus-visible / active / disabled / loading`，其中 `loading` 仅工具栏 app 与终端长任务使用（app 未 ready 时点击无响应，现状如此）。事件命名用 `kebab-case` 的 CustomEvent（`app-toggled`、`placement-updated`、`toggle-notification`、`toggle-app`），且必须 `bubbles/composed` 才能跨 Shadow 边界被宿主捕获。所有颜色、尺寸、圆角、时长引用令牌（23.1/23.2/23.5），组件内不出现硬编码值——例外：`line-height` 与图标 viewBox 允许字面量。禁用态必须同时改变语义（`disabled`/`aria-disabled`）与视觉，不得只降透明度；加载态必须有可读文案或 `aria-busy`（拟议）。

### 24.8 Acceptance

| ID | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-24-01 | 任意页面 | 传非法 `placement="top"` | 控制台出现 `Invalid placement: …`，窗口位置保持原值 |
| A-24-02 | 工具栏隐藏 | 键盘 `Tab` | 焦点落在 `#dev-bar` 把手，bar 展开；`inert` 使内部按钮不被 Tab 命中 |
| A-24-03 | 打开设置 | 切换“Disable notifications” | 通知点立即隐藏，`change` 只派发一次 |
| A-24-04 | 审计有结果 | 悬停高亮块 | 对应列表项加 `hovered`，移出即移除 |
| A-24-05 | 覆盖层 | 点击复制 | 图标变对勾 2s 后复原；连续点击重置计时不叠加 |
| A-24-06 | 终端 40 列 | `astro add --help` | 表格拆行，命令与说明不重叠 |
