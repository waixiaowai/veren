# Admin 后台界面重设计方案 / Admin Console Redesign Proposal

> 状态 Status: 设计草案 Draft v1 · 日期 Date: 2026-10-20 · 范围 Scope: `plugins/admin/web/client`（SPA 外壳、视图、样式）与 `plugins/admin/ui/*`（主题 / 语言 / 图标 / 外壳包）
> 本文只做设计，不含任何代码改动。All design, no code changes.
> 调研来源见文末[参考链接清单](#11-参考链接清单--references)；结论见 [0. 结论先行](#0-结论先行--tldr)。

---

## 目录 / Contents

1. [现状审计](#1-现状审计--current-state-audit)
2. [外部参考调研](#2-外部参考调研--research)
3. [设计原则](#3-设计原则--principles)
4. [布局结构](#4-布局结构--layout)
5. [设计 Token](#5-设计-token--design-tokens)
6. [组件风格](#6-组件风格--components)
7. [暗色模式策略](#7-暗色模式策略--dark-mode)
8. [中英双语与排版](#8-中英双语与排版--bilingual-typography)
9. [两个候选方向与取舍](#9-两个候选方向与取舍--two-directions)
10. [实施路径与验收](#10-实施路径与验收--rollout--acceptance)
11. [参考链接清单](#11-参考链接清单--references)

---

## 0. 结论先行 / TL;DR

- **推荐主干：方向 A「静默控制台 / Quiet Console」**——以边框和排版建立层级、单一强调色、14px 基准、36px 表格行、暗色优先校准；骨架取自 shadcn/ui + Linear + Vercel Geist。
- **同时吸收方向 B「温和账本 / Calm Ledger」的三个零件**：导航分组标签、侧栏底部用户卡、带柔和底色的状态徽标。它们提升可读性但不增加颜色预算。
- 落地只要 **CSS + 极少量 JS**（首帧主题脚本、主题菜单），不引入框架、不加依赖、不破坏 CSP（`style-src 'self' 'unsafe-inline'`）。
- 现状有三个必须先补的硬伤：
  1. **主题包契约缺状态色**：`--admin-ok` / `--admin-warn` 只写在 `styles.css` 兜底里，不在 `ui/theme-default/client.js` 的包里，换主题会静默失配（见 [1.3](#13-token-清单与契约缺口--token-audit)）。
  2. **暗色用户首帧闪白**：`applyTheme()` 在 `loadPacks()` 之后才跑，而首帧已经用亮色兜底渲染（见 [7.2](#72-首帧不闪--no-fouc)）。
  3. **密度和字号不匹配**：15px 基准字 + 1.5 行高 + 1100px 内容宽，7 列用户表在 1366 宽屏上已经开始换行/挤压（见 [1.5](#15-问题清单--issues)）。

---

## 1. 现状审计 / Current State Audit

### 1.1 技术底座 / Stack facts

| 维度 | 现状 | 出处 |
| --- | --- | --- |
| 运行时 | 原生 ESM，无框架、无构建产物（`client/*.js` 直接由宿主静态提供） | `plugins/admin/web/client/` |
| 渲染 | `el(tag, props, children)` 手写 DOM 构造；`paint()` = `root.replaceChildren(node)`，路由/主题/语言切换都**整体重绘** | `views.js:145`、`app.js:172-180` |
| 样式 | 单文件手写 CSS（878 行），全部颜色/圆角/阴影走 `--admin-*` 自定义属性 | `styles.css` |
| 主题 | UI 包注册 `{ id, label, light, dark }`，SPA 把 token 以**内联属性**写到 `<html>` 上 | `runtime.js:59`、`app.js:162-170` |
| 语言 | 语言包注册两份同键字典，`t()` 缺键回退到键名本身 | `ui/locale-zh-en/client.js` |
| 图标 | 24×24 内联 `<svg stroke="currentColor">`，共 18 个 | `ui/icons-default/client.js` |
| 安全 | CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'` | `web/src/static.ts:96-101` |
| 静态白名单 | `.html/.js/.mjs/.css/.json/.svg/.png/.ico/.woff2/.webmanifest`，响应 `no-store` | `web/src/static.ts:19-30` |
| 导航 | 数据驱动：`{ id, labelKey, path, icon, permission, order }`，默认 5 项，order 以 10 为步长 | `providers/nav-default/src/contributions.ts` |
| 页面 | 仪表盘、用户、角色、审计、能力 5 页 + 登录/初始化/改密/改密弹窗 + 404/403 | `views.js` 导出清单 |
| 依赖 | `dependencies` 全是 workspace 内部包；`devDependencies` 只有 cordis / webserver / schemastery / vitest，**前端零第三方依赖** | `web/package.json` |

### 1.2 现有布局实测 / Current layout measured

| 元素 | 现值 | 备注 |
| --- | --- | --- |
| 外壳 | `grid-template-columns: 240px minmax(0,1fr)`，`100dvh` 固定，内容区独立滚动 | `styles.css:83-89` |
| 侧栏 | `padding: 16px 12px`，品牌行 + 5 个导航项，`gap: 2px` | `styles.css:91-143` |
| 顶栏 | `padding: 10px 18px`，左标题 + 右 6 个控件（用户名、主题、语言、改密、退出、移动端菜单）；实际高约 61px（10×2 + 40.5px 按钮） | `styles.css:152-179`、`views.js:678-720` |
| 内容区 | `padding: 24px`，页面 `max-width: 1100px` 居中，`gap: 16px` | `styles.css:186-200` |
| 基准字 | `15px / 1.5`，系统字体栈 | `styles.css:66-74` |
| 圆角 | 单一 `--admin-radius: 10px`，徽标强制 `999px` | `styles.css:29,641` |
| 阴影 | 单一 `--admin-shadow`，同时用于登录卡、弹窗、Toast、移动侧栏 | `styles.css:31,729,765,819,842` |
| 表格 | `th/td: padding 10px 14px`、`font-size .93rem`（约 14px → 行高约 42px），表头与行 hover 用同一个 `surface-2` | `styles.css:284-323` |
| 响应式 | 唯一断点 `max-width: 800px`：侧栏变抽屉、隐藏用户名与按钮文案 | `styles.css:829-861` |

### 1.3 Token 清单与契约缺口 / Token audit

现状**全部 token（11 个）**：

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--admin-bg` | `#f7f8fa` | `#0e1319` | 页面底色 |
| `--admin-surface` | `#ffffff` | `#151c24` | 卡片 / 侧栏 / 顶栏 |
| `--admin-surface-2` | `#eef1f5` | `#1d2731` | 内嵌块、hover、表头 |
| `--admin-border` | `#cfd6de` | `#2c3846` | 所有边框（分隔线与控件边框同值） |
| `--admin-text` | `#141a21` | `#e8eef6` | 正文 |
| `--admin-muted` | `#55616f` | `#a8b6c6` | 次要文字 |
| `--admin-accent` | `#1b5fc1` | `#6ea8fe` | 强调 |
| `--admin-accent-text` | `#ffffff` | `#08111d` | 强调上的文字 |
| `--admin-danger` | `#b3261e` | `#ff9b91` | 危险（文字与填充共用） |
| `--admin-radius` | `10px` | `10px` | 全部圆角 |
| `--admin-shadow` | 双层 8% | 双层 50% | 全部阴影 |

**缺口（设计必须修）：**

- `--admin-ok` / `--admin-warn` 仅存在于 `styles.css:32-34` 与 `:root[data-scheme='dark']` 兜底中（`styles.css:51-52`），**主题包没有声明**。于是任何第三方主题替换后，成功/警告徽标仍是默认主题的绿色/琥珀色，与新底色对比度不可控——契约承诺的「换主题只改值」在这里破了。
- 没有 `--admin-info`、`--admin-surface-3`（浮层底）、`--admin-subtle`（占位/极弱文字）、`--admin-border-strong`（控件边框 vs 分隔线）。
- 没有间距、字号、控件高度、动效、层级 token：`padding: 9px 10px`、`18px`、`6px`、`4px`、`20px` 混用，字号出现 `.78/.8/.82/.85/.88/.9/.93/.94/1.05/1.2/1.35/1.8rem` 共 12 档，字重出现 `550` 与 `650` 两档非标准值（与 400/500/600 混用，`styles.css:106,644`）。

### 1.4 组件清单 / Component inventory

`panel`、`stat`、`table`、`button`（primary/danger/ghost/small/block）、`icon-button`、`input`、`field`（label/hint/inline/group/options）、权限选择器（分组折叠 + 计数）、`badge`（ok/warn/danger/muted）、`state`（loading/empty/error/notFound/forbidden）、`auth-card`、原生 `<dialog>` 弹窗、`toast`（`role="status"`，4s 自动消失）、`spinner`、移动端抽屉 + `menu-toggle`。

### 1.5 问题清单 / Issues

按优先级，每条都带证据。

**P0（正确性 / 体验硬伤）**

1. **主题包契约不完整**：见 1.3。→ 需要契约 v2，把状态色纳入包。
2. **暗色首帧闪白**：`start()` 先 `paint(loadingView)`，再 `await loadPacks(publicManifest)`，最后 `applyTheme()`（`app.js:545-553`）。包是 `import()` 动态加载，暗色用户在包到达前看到亮色兜底层。→ 需要 `<head>` 里一个同源阻塞脚本，在首次绘制前写 `data-scheme`（CSP 禁止内联脚本，所以必须是文件）。
3. **表格 hover 与表头同色**（都用 `surface-2`，`styles.css:298-309`）：鼠标滑过时行与表头融成一片，长表里丢定位。→ 需要 `surface-3`（hover 层）或表头改用更弱的底。
4. **按钮高度不受控**：`.button` 用 `padding: 8px 14px` + 继承 15px 行高 → 实际约 40.5px；`.icon-button` 固定 36px；`.input` 约 42.5px。三种控件在顶栏并排时基线不齐（`styles.css:335-346,386-400,426-434`）。

**P1（视觉与信息层级）**

5. **15px 基准偏大**：7 列用户表（姓名/邮箱/角色/状态/最后登录/创建/操作）在 1100px 内容宽里靠 `row` 高度硬撑；中文 15px 行高 1.5 让每个单元格至少 42px 高。
6. **内容宽 1100px 偏窄**：1280–1440 屏两侧留白过多，表格被迫压缩；审计页的长文本列 `max-width: 360px` 反而浪费横向空间（`styles.css:329-332`）。
7. **单一圆角 10px**：徽标 999px，弹窗 12px（`calc(+2)`），登录卡 14px（`calc(+4)`）——同一套视觉语言里出现四种圆角推导，没有阶梯。
8. **阴影语义混乱**：卡片无阴影（只有边框），但登录卡/弹窗/Toast 共用一个 8%/50% 阴影；暗色下 50% 黑阴影几乎不可见，却抬高了浮层的"灰边"。
9. **字重非标准**：`650`、`550` 在 Windows/部分中文字体回退下会被量化成 700/500，跨平台不一致。
10. **层级靠字号堆叠**：页面标题 1.35rem、面板标题 1.05rem、统计值 1.8rem，没有中间档，也没有 `letter-spacing` 控制英文全大写标签。

**P2（打磨）**

11. **加载态只有 spinner**：表格加载时整页替换成 `state` + spinner（`app.js:489-497`、`views.js:487-493`），页面骨架跳动；重绘还会丢滚动位置（全量 `replaceChildren`）。
12. **空态与搜索无结果用同一个组件**，只有文案不同（`views.js:985-987`），缺少"清空筛选"这类出口动作。
13. **`toast` 4s 固定、不暂停、最多无限堆叠**（`app.js:176-180`）。
14. **主题按钮只显示 sun/moon**：三态（亮/暗/跟随系统）里"跟随系统"没有可见表达，点按循环也不可预测（`app.js:506-512`）。
15. **双语排版未约束**：英文标签比中文长 20–35%，`nav-link` 靠 `text-overflow: ellipsis` 兜底；按钮内文案 + 图标组合在中文下偏短、英文下偏挤。
16. **无 `prefers-contrast` / `forced-colors` 处理**，高对比需求用户只能吃默认配色。

### 1.6 现状评分 / Scorecard（1–5，5 最好）

| 维度 | 分数 | 理由 |
| --- | --- | --- |
| 布局骨架 | 3.5 | 网格正确、逻辑属性（`border-inline-end`）用得干净；宽/密度需调 |
| 视觉层级 | 2.5 | 字号/字重/颜色三套手段混用但缺少阶梯 |
| 信息密度 | 2 | 15px + 43px 行高 + 1100px 上限 |
| 配色 | 3 | 单一强调色克制；状态色不全、无柔和底 |
| 暗色模式 | 3 | 机制齐全（属性 + `color-scheme` + 系统监听）；首帧闪白、层级弱 |
| 双语 | 3 | 回退策略优秀（缺键显示键名）；排版未适配 |
| 可访问性 | 3 | focus-visible、`aria-current`、原生 `<dialog>`、`role=status` 已有；对比度与 200% 缩放未验 |
| 可维护性 | 4 | 无框架、无构建、单文件 CSS，改造成本低 |

### 1.7 不可动约束 / Hard constraints

1. **零 / 极低依赖**：不引入 React、Tailwind、图表库、组件库；不新增运行时 npm 依赖。
2. **无构建步骤**：`client/` 下的 `.js` / `.css` 直接被宿主以 `text/javascript`、`text/css` 提供；不能引入 TSX 或需要打包的写法。
3. **CSP 无外链**：不得引用 Google Fonts、CDN 图标、远程图片；内联 `<script>` 被 `script-src 'self'` 禁止；**`style` 属性与内联 `<style>` 允许**（`'unsafe-inline'`）。
4. **离线可渲染**：`styles.css` 头部明确"无外部字体/图片/URL"。
5. **主题包契约**：包只提供值，CSS 拥有布局；包加载失败必须回退到 `:root` 兜底。
6. **双语**：所有文案走语言包键；键缺失回退到键名（不允许偷偷回英文）。
7. **权限驱动 UI**：导航与页面都按 `permissions` 裁剪，外壳不发明权限。

---

## 2. 外部参考调研 / Research

调研方法：`web_search` 定位官方文档与作品站，`web_fetch` 抓原文；能抓到代码的抓代码（shadcn registry、Tabler docs、Tremor 组件源码），抓不到的（Dribbble/Behance 正文、Ant Design Pro 演示站）在文中明确标注。每条格式为：**来源 → 实录要点（布局 / 配色 / 字体 / 密度 / 暗色）→ 可借鉴 / 不适用**。

### 2.1 shadcn/ui — Dashboard & Sidebar Blocks

- 链接：[ui.shadcn.com/blocks/dashboard](https://ui.shadcn.com/blocks/dashboard)、[ui.shadcn.com/blocks/sidebar](https://ui.shadcn.com/blocks/sidebar)
- **布局**：`<SidebarProvider style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' }}>`——把侧栏宽与顶栏高做成**可被页面覆盖的 CSS 变量**，`AppSidebar variant="inset"` 让侧栏与内容共享一块圆角面板。`sidebar-01` 的顶栏是 `h-16 border-b px-4` + 面包屑 + `SidebarTrigger`。
- **配色**：语义 token 命名（`bg-background`、`text-foreground`、`bg-card`、`border-input`、`ring-ring`、`bg-muted/50`、`text-muted-foreground`），暗色只在少数处用 `dark:` 变体（如按钮 `dark:bg-destructive/60`、`dark:border-input dark:bg-input/30`）。registry 的 `index` 只做 `@apply border-border outline-ring/50` + `body { @apply bg-background text-foreground }`——**元素默认继承语义色，而不是逐个写死**。
- **字体 / 密度**（registry 源码实测）：Card `flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm`，头 `px-6 gap-2`，体 `px-6`；Table 表头 `h-10 px-2`、单元格 `p-2`、行 `border-b hover:bg-muted/50`；Button 默认 `h-9 px-4 text-sm rounded-md`，另有 `h-8` / `h-10` / `size-9` 图标档；Badge `rounded-full px-2 py-0.5 text-xs`。
- **可借鉴**：① 侧栏宽/顶栏高做变量；② 卡片 = 边框 + `shadow-sm` + 大内距（24px）+ `gap-6`；③ 控件高度**成档**（32/36/40）而非 padding 推导；④ 徽标统一 `rounded-full` + 12px；⑤ "inset" 侧栏让应用看起来像一块整体面板。
- **不适用**：其间距/字号全建立在 Tailwind 的 4px 尺度与 `--spacing` 上，我们只能学**比例**，值要换成自己的 token。

### 2.2 shadcn/ui — Theming & Dark Mode 文档

- 链接：[ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming)、[ui.shadcn.com/docs/dark-mode](https://ui.shadcn.com/docs/dark-mode)
- 说明：两页正文均由客户端渲染，`web_fetch` 只拿到导航壳；**token 命名与 dark 变体的结论来自 registry 源码（`/r/styles/new-york-v4/*.json`）实测**，不是文档正文。
- **可借鉴**：token 分「表面 / 前景 / 边框 / 环 / 危险」五类，暗色只改值不改结构；这与我们的 `--admin-*` 契约同构，说明方向正确，缺的只是**补全类别**。
- **不适用**：`oklch()` + Tailwind v4 主题变量（`@theme inline`）依赖构建期，无构建环境用不了；我们继续用十六进制/`color-mix()`。

### 2.3 Tremor — Cards / Tables / Bar lists

- 链接：[tremor.so](https://www.tremor.so/)、[docs/ui/card](https://www.tremor.so/docs/ui/card)、[docs/ui/table](https://www.tremor.so/docs/ui/table)、[docs/visualizations/barlist](https://www.tremor.so/docs/visualizations/barlist)
- **布局 / 卡片**：`relative w-full rounded-lg border p-6 text-left shadow-xs`，`bg-white dark:bg-[#090E1A]`，`border-gray-200 dark:border-gray-900`；正文 `text-sm leading-6`，标题 `font-semibold text-gray-900 dark:text-gray-50`。
- **密度**：表格 `w-full overflow-auto whitespace-nowrap`；数字列右对齐 + `TableFoot` 汇总行；BarList 行高固定 `h-8`、行距 `space-y-1.5`、圆角 `rounded-sm`——**微可视化用固定行高换取扫读节奏**。
- **暗色**：卡片暗底不是纯黑（`#090E1A`），边框比底色更暗（`gray-900`），即"暗色里用更暗的边框"而非更亮的。
- **可借鉴**：① KPI 卡片的"标签小 / 数值大 / 微图表"三段结构；② 表格汇总行（审计/用户数直接给总计）；③ 暗色边框方向（比表面更暗一档）。
- **不适用**：Radix/Recharts 依赖；其 `dark:` 双写策略在有 token 体系时是冗余的。
- 官网自述 "We already pushed the pixels so that you can focus on data"——**默认值要好**，这正是我们重设计要抓的：不给使用者留"自己调"的余地。

### 2.4 Tabler — Color modes / Page layouts / Typography

- 链接：[docs.tabler.io/ui/getting-started/color-modes](https://docs.tabler.io/ui/getting-started/color-modes)、[docs.tabler.io/ui/layout/page-layouts](https://docs.tabler.io/ui/layout/page-layouts)、[docs.tabler.io/ui/base/typography](https://docs.tabler.io/ui/base/typography)、[github.com/tabler/tabler](https://github.com/tabler/tabler)
- **主题机制**：`data-bs-theme`（light/dark/auto）+ `data-bs-theme-base`（slate/gray/zinc/neutral/stone 五种灰阶）+ `data-bs-theme-primary`（13 色）+ `data-bs-theme-radius`（0/0.5/1/1.5/2）+ 布局属性（navbar 位置、容器宽、折叠侧栏）。值来源三选一：URL 参数 > `localStorage` > 服务端属性。
- **暗色**：`auto` 在加载时把 `prefers-color-scheme` **立刻解析成 light/dark**（不保留字面量 `auto`），并监听系统变化；**主题脚本必须放在 `<body>` 开头且不能 `defer/async`，否则先画亮色再翻暗色 = FOUC**（原文明确警告）。
- **布局**：`.page-header`（标题行）→ `.page-body`（`container-xl`）→ `row-deck row-cards` + `col-sm-6 col-lg-3` 四张卡；侧栏支持 `folded` / `folded-hover`（折成图标轨、hover 展开）。
- **排版**：`lead` 段落**不放大字号**，只转成次要色——用颜色而不是尺寸表达"副标题"。
- **可借鉴**：① 折叠图标轨（我们 248→64px 折叠态）；② FOUC 的解法（首帧前写属性）；③ 用"次要色"代替"更大字号"表达副标题；④ 主题设置面板的键值化（灰度/主色/圆角/布局各自独立存储）——可作为未来"外观设置"抽屉的骨架。
- **不适用**：Bootstrap 语义类与 Sass 构建。

### 2.5 daisyUI — Themes & Colors

- 链接：[daisyui.com/docs/themes](https://daisyui.com/docs/themes/)、[daisyui.com/docs/colors](https://daisyui.com/docs/colors/)
- **配色**：语义命名 + **成对前景色**：`primary` / `primary-content`、`base-100/200/300` / `base-content`、`info|success|warning|error` 各配 `-content`。文档明确对比"硬编码色名"与"语义色名"，后者的收益是**自动暗色、无限主题、零维护**。
- **暗色**：`data-theme` 属性 + `--prefersdark` 标记；35 套内置主题。
- **可借鉴**：① **每个状态色必须配前景色**（`ok` 与 `ok-content`），否则柔和底上的文字必然踩对比度坑；② `base-100/200/300` 的三级表面阶梯，比我们两级（surface / surface-2）更能表达"页面 / 卡片 / 浮层 / 内嵌"。
- **不适用**：主题数量不是目标；我们只要一套默认 + 可换包。

### 2.6 Vercel Geist — Colors & Typography

- 链接：[vercel.com/geist/colors](https://vercel.com/geist/colors)、[vercel.com/geist/typography](https://vercel.com/geist/typography)
- **配色**：10 条色阶；**Background 1 / 2** 两级页面底；**Color 1–3 = 组件背景（默认 / hover / active）**；**Color 4–6 = 边框（默认 / hover / active）**；**Color 7–8 = 高对比背景**；`gray-alpha` 只用于"需要透出背景"的场合（阴影、遮罩），并要求**阴影必须半透明**（不透明阴影会留下灰晕）；"每条边只画一次"（避免 alpha 边框叠出深色接缝）。
- **排版**：`heading / label / copy / button` 四条阶梯，每档预组合 size + line-height + letter-spacing + weight；最常用是 **Label 14**；12px + 大写用于三级信息（注释、"Show more"）；**数字用 tabular**（`text-label-13` + tabular）；等宽与正文成对出现。
- **可借鉴**：① 表面/边框各三档"默认-hover-active"是**交互状态的 token 化**，比在每个组件里写 `:hover` 颜色更一致；② 半透明阴影 + 单边绘制；③ 排版按"用途"命名（label/copy 而不是 h1/h2），和双语、国际化场景更契合。
- **不适用**：Geist Sans/Mono 字体文件（CSP 与外链约束，且中文仍需回退）。

### 2.7 Linear — How we redesigned the Linear UI

- 链接：[linear.app/changelog/2024-03-20-new-linear-ui](https://linear.app/changelog/2024-03-20-new-linear-ui)、[linear.app/now/how-we-redesigned-the-linear-ui](https://linear.app/now/how-we-redesigned-the-linear-ui)
- **布局**：先聚焦 "inverted L"——**侧栏 + 顶栏组成的全局 chrome**，其余先不动；明确目标是"降低视觉噪音、保持对齐、提升导航的层级与密度"。
- **配色**：亮/暗两套都**提高了对比度**；主题生成从 98 个变量收敛到 **3 个（base color / accent color / contrast）**，用 **LCH**（而非 HSL）保证不同色相在同等明度下看起来一样亮；`contrast` 变量让高对比主题可以自动派生。
- **字体 / 密度**：侧栏里"标签、图标、按钮"的水平与垂直对齐被单列为一项工作——"你不会立刻看到，但用几分钟就会感觉到"。
- **可借鉴**：① **先重做 chrome（侧栏+顶栏），再改内容页**，风险最小、收益最大；② 用少量基础变量 + 派生，而不是维护几十个手调颜色（我们的 `color-mix()` 派生就是这个思路）；③ 高对比主题作为 `contrast` 变体，而不是另做一套；④ 对齐是重设计的一等公民——图标 18px / 行高 34px / 内距 10px 必须成网格。
- **不适用**：LCH 运行时生成（无构建、且要离线）；我们预生成两套值写进主题包，派生量控制在"柔和底/描边"级别。

### 2.8 Dribbble / Behance — admin dashboard 关键词取样

> ⚠️ 取证说明：Dribbble 对抓取返回 `HTTP 202`（挑战页），Behance 连接被拒；**正文与作品图均未取到**。以下仅按搜索结果索引中的标题/摘要取样，不作为设计依据，只用于判断"作品站上的关键词走向"。

| 链接 | 索引标题 | 可读出的走向 |
| --- | --- | --- |
| [dribbble.com/shots/27071014](https://dribbble.com/shots/27071014--Analytics-Dashboard-UI-UX-Light-Dark-Mode-SaaS-Design) | Analytics Dashboard UI/UX · Light & Dark Mode (SaaS) | 亮暗双模作为卖点成对展示 |
| [dribbble.com/shots/27457353](https://dribbble.com/shots/27457353-Vision-Analytics-Dashboard-Dark-Mode-Admin-Design) | Vision Analytics Dashboard — Dark Mode Admin | "暗色 + 分析型"是独立品类 |
| [dribbble.com/shots/21743254](https://dribbble.com/shots/21743254-BuiLD-2-0-Day-03-Dark-Themed-Neon-Admin-Dashboard) | Dark-Themed Neon Admin Dashboard | 霓虹风存在，但对长时间使用的后台是反例 |
| [behance.net/gallery/239941597](https://www.behance.net/gallery/239941597/TechNova-Minimal-Admin-Dashboard-UI) | TechNova — Minimal Admin Dashboard UI | "极简"是主流标签 |
| [behance.net/gallery/244093753](https://www.behance.net/gallery/244093753/Buyur-Admin-Superadmin-Dashboards) | Buyur — Admin & Superadmin Dashboards | 单套设计要覆盖多角色/多仪表盘 |

**结论（低置信度）**：作品站的流行词是"极简 + 亮暗双模 + 分析卡"；霓虹/玻璃拟态有明显存在感，但**不适合本项目的 8 小时值守场景**（低对比、装饰噪声、暗色下发灰）。可借鉴的只有"亮暗成对交付"与"每角色一套落地页"这两点。

### 2.9 补充：2026 仪表盘趋势综述（二手来源）

- 链接：[adminlte.io/blog/saas-dashboard-design-examples](https://adminlte.io/blog/saas-dashboard-design-examples/)（内容营销博客，**二手**，仅用于交叉印证，不单独作为事实依据）
- 其归纳与本报告独立观察一致：暗色优先（Linear/Supabase/Vercel）、**安静 chrome + 高密度**、**表格回归主界面**（Stripe/Retool）、**颜色只表达状态与含义**（Vercel）、空态/加载态与数据态同等投入。文中对 Vercel 的概括是"单色系统里 status 色承载全部语义"，与我们"颜色只表达状态"的原则同向。
- 反向校验：它把 `Linear` 归为"dark-first power tool"，与 Linear 官方博客"两套主题都提高对比度"并不冲突——"暗色优先设计"≠"只做暗色"。

### 2.10 未取到的候选来源（诚实记录）

- **Ant Design Pro**（[pro.ant.design](https://pro.ant.design/)、[preview.pro.ant.design](https://preview.pro.ant.design)）：文档站 302 到演示站，演示站为纯客户端渲染，抓取只得到 `<title>`。因此本报告**不引用其任何设计细节**，仅记为"未取证"。若后续需要 ProLayout 的侧栏+面包屑+页签结构细节，应改为查其 GitHub 源码或本地安装后阅读。
- **Behance / Dribbble 正文**：同 2.8 的取证说明。

---

## 3. 设计原则 / Principles

1. **颜色只表达状态 / Color means state.** 中性色负责结构与层级，强调色只标"当前/主操作"，红黄绿只标"异常/警告/正常"。任何装饰性用色一律删除。
2. **边框优先，阴影只给浮层 / Borders first, shadows only for overlays.** 卡片、表格、侧栏用 1px 边框建立边界；阴影只出现在弹窗、Toast、下拉、抽屉。暗色下阴影本来就弱，靠边框才可靠。
3. **三档密度 / Three densities.** 导航（34px 行）、表格（36px 行 / 紧凑 32px）、表单（32px 控件、44px 弹窗字段）各自成档，不再用 padding 临时凑。
4. **Token 是唯一真相 / Tokens are the single source of truth.** 组件里不出现十六进制色值、不出现魔法 `px` 间距；派生值（hover 底、柔和底、焦点环）用 `color-mix()` 从 token 算出来。
5. **双语等宽 / Locale-proof layout.** 任何文案的长度变化不得改变布局：按钮最小宽度、导航省略、数字等宽、日期走 `Intl`。
6. **零依赖、零外链、可离线 / Zero-dependency, offline-safe.** 不加包、不引 CDN；字体用系统栈；图标用内联 SVG。

---

## 4. 布局结构 / Layout

### 4.1 桌面（≥1280）/ Desktop

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ 品牌  ▸ 设置 │ 概览 / 用户                          [搜索] [☾] [中] [avatar▾]│ 52px 顶栏（sticky）
├──────────────┼──────────────────────────────────────────────────────────────┤
│ 概览          │  用户                                              [+ 新建用户]│ ← page-header 20/28
│  仪表盘   ●   │  管理账号、角色与访问权限                                     │ ← 13px 描述
│              │                                                              │
│ 访问控制      │  ┌────────────┬────────────┬────────────┬────────────┐      │ ← KPI 行 4 列
│  用户         │  │ 用户 24    │ 角色 6     │ 审计 1,284 │ 能力 9/11  │      │
│  角色         │  └────────────┴────────────┴────────────┴────────────┘      │
│              │  ┌──────────────────────────────────────────────────────────┐│
│ 可观测性      │  │ [搜索姓名或邮箱…]        共 24 条      [导出] [筛选 ▾]  ││ ← toolbar 48px
│  审计    12   │  ├──────────────────────────────────────────────────────────┤│
│              │  │ 姓名 ▲   邮箱          角色    状态   最后登录    操作   ││ ← thead 36px sticky
│ 系统          │  │ 张三     z@ex.com      管理员   ● 启用  10-18 14:02  ⋯  ││ ← row 36px
│  能力         │  │ 李四     l@ex.com      审计员   ○ 停用  —           ⋯  ││
│              │  └──────────────────────────────────────────────────────────┘│
│              │                                    共 24 条 · 第 1 / 2 页    │ ← 分页页脚
│ ┌──────────┐ │                                                              │
│ │ 张 三     │ │                                                              │
│ │ 管理员  ▾ │ │                                                              │
│ └──────────┘ │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
   248px                              内容区：padding 24/32，max-width 1280，居中
```

### 4.2 折叠态（1024–1279 或手动折叠）/ Collapsed rail

```
┌──────┬─────────────────────────────────────────┐
│  ▣   │ 概览 / 用户            [☾] [中] [avatar]│
├──────┼─────────────────────────────────────────┤
│  ▤ ● │  用户                      [+ 新建用户]  │
│  👥  │  ┌───────────────────────────────────┐  │
│  🛡  │  │ 表格（横向可滚，首列 sticky）      │  │
│  📋12│  └───────────────────────────────────┘  │
│  ⬡   │                                         │
└──────┴─────────────────────────────────────────┘
  64px      悬停/聚焦展开为浮层侧栏（不挤压内容）
```

### 4.3 移动（<768）/ Mobile

```
┌─────────────────────────────┐
│ ☰  用户            [☾] [中] │ 52px sticky
├─────────────────────────────┤
│ 用户            [+ 新建]     │ 标题与主操作同排，操作降为图标按钮
│ [搜索…]                     │
│ ┌─────────────────────────┐ │
│ │ 表格横向滚动，首列固定   │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
抽屉侧栏 280px + 40% 遮罩，点击导航后关闭；触控目标 ≥40px
```

### 4.4 尺寸规格 / Layout specs

| 项 | 桌面 | 折叠 | 移动 | 说明 |
| --- | --- | --- | --- | --- |
| 侧栏宽 | 248px | 64px | 280px 抽屉 | 比现状 240 略宽，容纳"图标+标签+计数徽标" |
| 顶栏高 | 52px | 52px | 52px | 现状约 41px；52 给 32px 控件留 10px 呼吸 |
| 内容 padding | 32px 40px | 24px 32px | 16px | 断点 1280 / 1024 / 768 / 640 |
| 内容最大宽 | 1280px | 1280px | 100% | 比现状 1100 宽，7 列表格不再挤压 |
| 栅格 | 12 列，gap 16/24 | 同 | 1 列 | KPI 4 列 → 2 列 → 1 列 |
| 页面纵向节奏 | header 20 → gap 24 → 卡片 16 | 同 | 16 | 用间距 token，不写魔法值 |
| z 轴 | 内容 0 / sticky 10 / 侧栏 30 / 遮罩 35 / 弹窗 50 / Toast 60 | | | 现状 Toast 50、侧栏 30，弹窗原生 top-layer 不参与 |

### 4.5 页面骨架 / Page scaffold（5 个页面统一）

```
page-header     标题 + 一句描述（可选）+ 主操作 + 次操作
toolbar         搜索 / 筛选 / 计数 / 批量操作（仅在选中时出现第二行）
surface         表格或表单卡（可含汇总页脚）
pagination      条数 + 页码（或"加载更多"，审计页保留）
```

- 仪表盘：`page-header` → KPI 4 卡 →（可选）"最近审计"表 + "能力健康"列表，两列 8/4 分栏。
- 用户：`page-header` → toolbar（搜索 + 状态筛选）→ 表格（含空态）→ 分页。
- 角色：左列角色列表（可选中）→ 右列权限摘要；比现在"一张宽表 + 弹窗"更易读（权限选择器已在弹窗里，保留）。
- 审计：`page-header` → toolbar（搜索 + 结果筛选）→ 时间线式表格 → "加载更多"。
- 能力：`page-header` → 状态汇总条（激活/缺失/降级计数）→ 能力表（能力名 / provider / 状态）。

### 4.6 主导航分组 / Nav grouping

现状 5 项平铺（仪表盘/用户/角色/审计/能力），语义上其实是三组。建议在 `AdminNavContribution` 上**新增可选 `sectionKey`**（additive，不破坏现有 provider），SPA 按 `sectionKey` 分组、缺失时按 `order` 兜底归入"通用"：

| 分组（EN / 中文） | 成员 | sectionKey |
| --- | --- | --- |
| Overview / 概览 | 仪表盘 | `overview` |
| Access / 访问控制 | 用户、角色 | `access` |
| Observability / 可观测性 | 审计 | `observability` |
| System / 系统 | 能力 | `system` |

分组标签排版：英文 11px / `letter-spacing: .06em` / 大写 / `subtle` 色；中文 12px / 不加字距 / `subtle` 色（大写与字距对中文无意义，见 [8](#8-中英双语与排版--bilingual-typography)）。

### 4.7 顶栏内容重排 / Topbar content

现状 6 个控件平铺（用户名、主题、语言、改密、退出、菜单）。重排为 **3 个可见 + 1 个菜单**：

```
[面包屑/页面标题]                            [⌘K 搜索*] [主题 ▾] [中/EN] [avatar ▾]
                                                                     ├ 修改密码
                                                                     ├ 外观设置
                                                                     └ 退出登录
```

- **主题**改为点击弹小浮层（亮色 / 暗色 / 跟随系统 三选一，带当前态勾选），不再三态循环。用原生 `popover` 属性 + `<button>` 实现，无需库；浏览器不支持时回退为循环按钮。
- **语言**保持单击切换（仅两语言，循环是合理的）。
- **用户名**移入 avatar 菜单（首字母圆形头像），给导航标题腾出空间。
- *⌘K 搜索为 P3 可选，见 [10](#10-实施路径与验收--rollout--acceptance)。

---

## 5. 设计 Token / Design Tokens

三层：**基础 token（主题包提供）→ 派生 token（CSS 计算）→ 组件局部变量（`--card-*` 等，只在组件内部）**。

### 5.1 色板 · 方向 A（推荐）/ Palette A

| Token | Light | Dark | 语义 | 对比度（正文/表面） |
| --- | --- | --- | --- | --- |
| `--admin-bg` | `#f7f8fa` | `#0b0e12` | 页面底 | — |
| `--admin-surface` | `#ffffff` | `#11151b` | 卡片 / 侧栏 / 顶栏 | 文字 17.9:1 (L) / 15.7:1 (D) |
| `--admin-surface-2` | `#f1f3f6` | `#171d25` | 内嵌块、表头、输入底 | — |
| `--admin-surface-3` | `#ffffff` | `#1d2530` | 浮层、行 hover（比 2 更"近"） | — |
| `--admin-border` | `#e3e7ec` | `#242c37` | 分隔线 | 对表面 ≈1.1:1（仅装饰） |
| `--admin-border-strong` | `#cbd3dd` | `#36424f` | 控件边框（不承担唯一识别，故不要求 3:1） | 1.6:1 / 1.8:1 |
| `--admin-text` | `#171a1f` | `#e9eef5` | 正文 | 17.9:1 / 15.7:1 |
| `--admin-muted` | `#5b6472` | `#a2aebf` | 次要文字 | 6.0:1 / 8.2:1 |
| `--admin-subtle` | `#6b7484` | `#808da0` | 占位、12px 注释 | 4.7:1 / 5.4:1 |
| `--admin-accent` | `#1b5fc1` | `#6ea8fe` | 主操作、当前项（**沿用现值**） | 白字 6.1:1 / 7.6:1 |
| `--admin-accent-text` | `#ffffff` | `#08111d` | 强调底上的字 | 6.1:1 / 7.9:1 |
| `--admin-ok` | `#15803d` | `#5fd39b` | 正常 / 启用 | 5.0:1 / 9.1:1 |
| `--admin-warn` | `#8a5a00` | `#e5b567` | 警告 / 降级 | 5.9:1 / 8.6:1 |
| `--admin-danger` | `#b42318` | `#ff8f85` | 危险 / 停用 | 6.6:1 / 7.4:1 |
| `--admin-info` | `#1a6fa8` | `#7cc4e8` | 信息 | 5.4:1 / 8.0:1 |
| `--admin-radius` | `8px` | `8px` | 基准圆角 | — |
| `--admin-shadow` | `0 8px 24px rgb(16 24 40 / .12), 0 2px 6px rgb(16 24 40 / .06)` | `0 10px 28px rgb(0 0 0 / .55), 0 2px 8px rgb(0 0 0 / .4)` | **仅浮层** | — |

> 对比度为按 WCAG 2.x 相对亮度公式的手算值（四舍五入到 0.1），实现后须用 axe / Lighthouse 复核；`border-strong` 不作为文字或唯一识别手段，故不要求 4.5:1。
> **强调色刻意沿用现值**：`#1b5fc1` 的白字对比度已是 6.1:1，换色只会带来回归风险而不带来可用性收益（原则 1：颜色只表达状态）。
> `surface` 与 `bg` 的明度差刻意只有约 2%：**边界由边框提供**（原则 2），这也是 shadcn/Tremor/Vercel 的共同做法。

### 5.2 派生 token / Derived tokens

只加 4 条规则，不增加主题包负担：

```css
:root {
  --admin-radius-sm: calc(var(--admin-radius) - 4px);   /* 4 */
  --admin-radius-lg: calc(var(--admin-radius) + 4px);   /* 12 */
  --admin-ring: color-mix(in oklab, var(--admin-accent) 55%, transparent);
  --admin-accent-soft: color-mix(in oklab, var(--admin-accent) 12%, var(--admin-surface));
  --admin-ok-soft:     color-mix(in oklab, var(--admin-ok) 12%, var(--admin-surface));
  --admin-warn-soft:   color-mix(in oklab, var(--admin-warn) 14%, var(--admin-surface));
  --admin-danger-soft: color-mix(in oklab, var(--admin-danger) 12%, var(--admin-surface));
  --admin-info-soft:   color-mix(in oklab, var(--admin-info) 12%, var(--admin-surface));
  --admin-surface-hover: color-mix(in oklab, var(--admin-text) 4%, var(--admin-surface));
}
@supports not (color: color-mix(in oklab, red, blue)) {
  :root { --admin-accent-soft: var(--admin-surface-2); /* 降级：柔和底退成中性底 */ }
}
```

> `color-mix()` 自 Chromium 111 / Safari 16.2 / Firefox 113（2023 年）可用；后台使用者环境可控，且 `@supports` 有降级。若要求更保守，可把 `*-soft` 提升为包内 token（包从 16 增到 21）。

### 5.3 间距阶梯 / Spacing scale

4px 基准：`2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`（token 名 `--sp-1 … --sp-12`）。

| 用途 | 值 |
| --- | --- |
| 图标与文字 | 8 |
| 控件内距（横向） | 10（sm）/ 12（md） |
| 卡片内距 | 16（紧凑）/ 20（默认）/ 24（宽松，登录卡与空态） |
| 卡片间距（KPI 行） | 16 |
| 区块间距（header→toolbar→table） | 20 / 16 |
| 页面外边距 | 24 / 32 / 40（按断点） |
| 弹窗内距 | 20 24（头/体/脚一致） |

现状的 `9px 10px`、`18px`、`6px`、`-2px` 这类值全部并入阶梯。

### 5.4 圆角 / 边框 / 阴影

| 档 | 值 | 用在哪 |
| --- | --- | --- |
| `sm` | 4px（`radius - 4`） | 徽标内小标记、代码块、条形图 |
| `md` | 8px（`radius`） | 按钮、输入、导航项、徽标（改用 999 亦可） |
| `lg` | 12px（`radius + 4`） | 卡片、表格容器、Toast |
| `xl` | 16px | 登录卡、空态块、抽屉 |
| `full` | 999px | 状态徽标、头像、开关 |

- 边框：分隔线 1px `--admin-border`；控件 1px `--admin-border-strong`；卡片 1px `--admin-border`；**不叠加阴影**。
- 阴影：只有浮层用 `--admin-shadow`；卡片 hover **不加阴影**（避免"卡片浮起来"的廉价感），只改边框或背景。
- 暗色阴影用纯黑高不透明度 + 更小扩散，避免灰晕（Geist 的"半透明阴影"要求）。

### 5.5 字体阶梯 / Type scale

14px 基准（现状 15px）。理由：7 列表格 + 中文界面在 1280 宽下需要这一档；正文 14/21 在 100% 与 125% 缩放下都稳。

| 角色 | size / line-height | weight | 用途 |
| --- | --- | --- | --- |
| `display` | 24 / 32 | 600 | 登录页标题、空态大标题（少用） |
| `title` | 18 / 26 | 600 | 页面标题（`page-title`） |
| `section` | 15 / 22 | 600 | 卡片标题、弹窗标题 |
| `body` | 14 / 21 | 400 | 正文、表格单元格 |
| `small` | 13 / 19 | 400 | 描述、表单提示、表格次要列 |
| `caption` | 12 / 16 | 500 | 分组标签、字段标签、页脚计数 |
| `micro` | 11 / 15 | 600 | 英文全大写标签（加 `.06em` 字距） |
| `mono` | 12.5 / 18 | 400 | 权限串、ID、时间戳（`tabular-nums`） |

字重只用 **400 / 500 / 600**（删掉 550/650）。中文标题一律 600，不用 700（中文字体在 700 下笔画糊）。

字体栈（无外链）：

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', 'Helvetica Neue',
             'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC',
             'Source Han Sans SC', sans-serif;
font-variant-numeric: tabular-nums;   /* 表格、统计值、时间 */
```

等宽栈：`ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, 'Liberation Mono', monospace`。

> 可选（P3）：把一款开源 CJK 子集字体以 `.woff2` 放本地（静态白名单已含 `.woff2`），但会增加 1–3MB 与首屏字体加载；**默认不推荐**，系统字体在 Windows/macOS 上的中文效果已足够。

### 5.6 控件尺寸与密度 / Control sizes

| 尺寸 | 高度 | 内距（横） | 字号 | 用在哪 |
| --- | --- | --- | --- | --- |
| `xs` | 24 | 8 | 12 | 表格内联操作、徽标按钮 |
| `sm` | 28 | 10 | 13 | 工具栏、弹窗次要按钮 |
| `md` | 32 | 12 | 14 | **默认**：按钮、输入、选择 |
| `lg` | 36 | 16 | 14 | 登录表单、页面主操作 |
| `icon` | 32×32 | 0 | — | 顶栏图标按钮 |

- 表格行高：默认 36（`td` padding 6 12，字号 14），紧凑 32（字号 13，padding 4 10）。
- 输入框含 border-box 高度 32/36，**不再用 padding 推高度**。
- 触控（<768）最小 40×40。
- 密度开关（P2）：`<html data-density="compact">` 只覆盖行高与内距，不动字号。

### 5.7 动效与层级 / Motion & z-index

| 用途 | 值 |
| --- | --- |
| 颜色/背景过渡 | 120ms `ease-out` |
| 浮层进入（弹窗/Toast/抽屉） | 180ms `cubic-bezier(.2,.8,.2,1)`，位移 4–8px + 透明度 |
| 侧栏折叠 | 160ms（现状 160ms，保留） |
| 加载骨架 | 1.2s 循环渐变，`prefers-reduced-motion` 下静止 |
| `prefers-reduced-motion` | 全部动画 ≤0.01ms（现有实现保留） |
| z-index | 内容 0 / sticky 10 / 侧栏 30 / 遮罩 35 / 弹窗 top-layer / Toast 60 |

### 5.8 主题包契约 v2 / Theme pack contract v2

**目标**：包仍是"数据 + `activate`"，但值必须完整；旧包不炸。

| 变更 | 内容 | 兼容策略 |
| --- | --- | --- |
| 扩容 | 11 → 16 个基础 token（新增 `surface-3`、`border-strong`、`subtle`、`ok`、`warn`、`info`；`danger` 保留） | 新增键缺失时落回 `:root` 兜底；**布局不受影响** |
| 状态色入包 | `ok/warn/info` 从"仅兜底"变成"必须由包声明" | 旧包未声明 → 用兜底值，并在控制台告警一次 |
| 派生层 | `*-soft`、`ring`、`radius-sm/lg` 由 CSS 计算，不进包 | 包无需关心 |
| 校验（可选） | `registerTheme` 时比对必需键，缺失 `console.warn`（不抛错，避免白屏） | 与现有"坏包只丢一个条目"的容错一致 |
| 版本 | `contract: '2.0.0'` 作为 `registerTheme` 的可选字段；SPA 不因版本拒绝加载 | 无版本视为 v1 |

**为什么不是"换一套命名"**：`--admin-*` 前缀已被 `styles.css`、主题包、潜在第三方包共同依赖；重命名收益为零、破坏面最大。v2 只做加法。

### 5.9 Token 使用规则 / Rules

1. 组件 CSS 里**禁止**出现 `#hex`、`rgb()`、`px` 间距魔法值（边框 1px、图标尺寸除外）。
2. hover / active / 柔和底一律用 `color-mix()` 或派生变量，不在组件里写第二套颜色。
3. 新增视觉状态必须先在 [5.1](#51-色板--方向-a推荐--palette-a) 找到对应 token；找不到 = 设计缺口，先补 token。
4. 主题包只能改变量值；若某个改动需要改布局，说明它不属于主题。

---

## 6. 组件风格 / Components

### 6.1 卡片 / Card

```
┌──────────────────────────────────────────┐ 1px --admin-border，radius-lg，bg surface
│ 标题 15/600            [次要操作]        │ 头：padding 16 20，底部分隔线可选
├──────────────────────────────────────────┤
│ 内容：padding 20（紧凑 16）              │
│                                          │
├──────────────────────────────────────────┤
│ 页脚（可选）：汇总/分页，padding 12 20   │
└──────────────────────────────────────────┘
```

- 无阴影、无渐变；hover 只对**可点击卡片**生效（边框转 `border-strong`）。
- 变体：`card--flush`（表格卡，内容区 padding 0）、`card--stat`（KPI）、`card--muted`（内嵌说明块，底 `surface-2`，无边框）。
- 现状 `.panel` 保留类名（减小改动面），只改样式；新增 `.card` 作为别名。

### 6.2 KPI 卡 / Stat

```
┌────────────────────────────┐
│ 用户            ↑ 12%      │ 标签 12/caption muted；右侧变化 12（ok/danger）
│ 24                         │ 数值 mono 24-28/600 tabular
│ ▁▂▃▅▆▇  近 7 天            │ 迷你条（可选）：高度 24，条宽 3，gap 2
└────────────────────────────┘
```

- 一屏最多 4 个 KPI；数值单位（如 `9 / 11`）用小号 `muted`。
- 无数据：数值位显示 `—`，迷你条隐藏，不显示 0（0 与"未知"是不同事实）。

### 6.3 表格 / Table

| 项 | 规范 |
| --- | --- |
| 容器 | `.table-wrap` = 卡片（边框 + radius-lg + `overflow: auto`）；表格不再自带边框 |
| 表头 | 高 36，`surface-2` 底，12/caption 大写（EN）/12 常规（ZH），**sticky top** |
| 行 | 高 36（紧凑 32），分隔线 1px `border`，**无斑马纹** |
| hover | `surface-hover`（≈4% 文字色叠加），与表头明确区分（修 P0-3） |
| 对齐 | 文本左；数字/日期右；`tabular-nums`；时间用 `Intl.DateTimeFormat` |
| 列宽 | `<colgroup>` 固定关键列（状态/操作 96/80），弹性列给姓名与邮箱 |
| 单元格 | padding 6 12；长文本 `max-width: 28ch` + `title` 全文；不折行靠 `white-space: nowrap` + 横向滚动 |
| 操作列 | 默认 1 个"⋯"菜单（编辑/删除），行 hover 不隐藏（可访问性）；危险项在菜单里用 danger 色 |
| 选择 | 首列 checkbox（可选批量），选中后工具栏下方浮出批量条（"已选 3 项 · 停用 · 删除 · 取消"） |
| 空态 | 表格内嵌空态行（图标 + 标题 + 一句说明 + 主操作），**不是**整块替换 |
| 加载 | 骨架行 × 5（表头保持），不用整页 spinner |
| 页脚 | 左"共 N 条"，右分页；审计页保留"加载更多" |

### 6.4 按钮 / Button

| 变体 | 底 | 字 | 边框 | 用在哪 |
| --- | --- | --- | --- | --- |
| primary | accent | accent-text | 同色 | 页面主操作（每屏最多 1 个） |
| secondary | surface | text | border-strong | 默认 |
| ghost | 透明 | text | 透明 | 顶栏、表格内 |
| danger | danger | **bg**（亮暗都反色） | 同色 | 删除确认（弹窗内） |
| danger-ghost | 透明 | danger | 透明 | 行内删除 |

- 状态：hover 叠 6% 文字色；active 叠 12%；`:focus-visible` = 2px `--admin-ring` + 2px offset；`disabled` 50% 透明 + `cursor: not-allowed`；加载中 = 左侧 14px spinner + 保持宽度 + `aria-busy`。
- 图标按钮固定 32×32，图标 18；带文字按钮的图标 16；图标与文字 gap 8。
- 中文按钮不设固定宽，设 `min-width`（如 88）避免长短跳变；英文允许增长 35% 不换行（`white-space: nowrap`）。

### 6.5 表单 / Form

```
┌ 标签 12/500 muted（必填加 *） ┐
│ [输入 32 高，radius-md        ]│
│ 提示 12 subtle                │
│ ✕ 错误 12 danger + 图标       │ ← 错误时边框转 danger，aria-invalid
└───────────────────────────────┘
```

- 字段纵向 gap 6；字段之间 gap 16；弹窗内两列栅格（≥480px 宽时）。
- 输入底 `surface-2`（现状已有），焦点：边框 `accent` + 3px `ring` 半透明；占位符 `subtle`。
- 校验时机：失焦校验 + 提交时汇总；错误文案在字段下方、与输入 `aria-describedby` 关联。
- 复选框/单选：18px 控件 + 8px 间距，整行可点（`label` 包裹）。
- 权限选择器（现有 `.picker-*`）增强：顶部加**筛选框**、每组"全选/清空"、组内计数 `已选 3 / 8`、行高 28 可点、折叠箭头 12px（现状 CSS 画的 7px 箭头偏小）。

### 6.6 弹窗 / Dialog

| 宽度 | 用途 |
| --- | --- |
| 420 | 确认（删除、退出） |
| 560 | 表单单列（新建用户、改密） |
| 720 | 双列表单 / 权限选择器 |

- 结构：头（标题 15/600 + 关闭 icon，padding 20 24）→ 体（滚动，padding 4 24 20）→ 脚（右对齐，gap 8，padding 16 24，顶部分隔线）。
- 原生 `<dialog>` + `showModal()` 保留（焦点陷阱、Esc、背板都是白送的）；补：关闭后**焦点回到触发按钮**、`::backdrop` 用 `rgb(4 8 14 / .55)`（现状一致）+ 可选 2px 模糊（性能敏感设备禁用）。
- 危险确认：标题明确对象（"删除用户 张三？"），正文说明后果，确认按钮用 `danger`，默认焦点在"取消"。

### 6.7 状态徽标 / Badge

| 语气 | 底 | 字 | 例子 |
| --- | --- | --- | --- |
| ok | `ok-soft` | `ok` | 启用、正常 |
| warn | `warn-soft` | `warn` | 降级、待处理 |
| danger | `danger-soft` | `danger` | 停用、失败 |
| info | `info-soft` | `info` | 内置、只读 |
| neutral | `surface-2` | `muted` | 计数、标签 |

- 形态：**圆点 + 文本**（`● 启用`），高 20，padding 2 8，字号 12，圆角 full；圆点 6px 用 `currentColor`。
- 只描边不填底的旧样式（`.badge.ok { border-color }`）改为柔和底——描边在暗色下几乎看不见。
- 永远带文字（不靠颜色单独传达状态）；计数徽标（导航里的 12）用 neutral，不用强调色。

### 6.8 Toast

- 位置右下（现状一致），宽 ≤360，最多同时 3 条（超出挤掉最旧）。
- 结构：图标（语气色）+ 标题（可选，13/600）+ 正文（13），左 3px 语气色条保留（低成本语义）。
- 时长 5s，hover/focus 暂停，可手动关闭；`role="status"` 保留，错误用 `role="alert"`。
- 重绘不销毁 Toast（现状 Toast 挂在 `document.body`，已正确；重设计不得把它挪进 root）。

### 6.9 三态 / States

- **加载**：内容区骨架（表格 5 行 / KPI 4 块），保留页头与工具栏，不整页替换。
- **空**：图标（48，`subtle`）+ 标题（15/600）+ 说明（13 muted）+ 主操作；"无数据"与"无搜索结果"用不同文案与不同动作（后者给"清空筛选"）。
- **错误**：图标 + 标题 + 服务端消息（`messageOf` 已有结构化映射）+ "重试"；不要吞掉 `code`。
- 三态都占满内容卡宽度，避免页面高度跳动。

### 6.10 侧栏 / Sidebar

- 品牌行：28px 标记 + 产品名（15/600），右侧折叠按钮（32×32）。
- 分组标签 + 导航项：行高 34，padding 0 10，圆角 8，图标 18，标签 14；当前项 = `accent-soft` 底 + `accent` 文字 + 600 字重 + `aria-current="page"`（现状有 `aria-current`，保留）。
- 计数徽标贴右（`margin-inline-start: auto`），neutral 语气。
- 底部用户卡：头像 32（首字母）+ 姓名（13/600）+ 角色（12 muted）+ "▾"；点击开菜单（修改密码 / 退出）。**把顶栏的退出与改密挪到这里**，顶栏更安静。
- 折叠态：只留图标，hover/focus 展开为 248px 浮层（Tabler `folded-hover` 思路），不挤压内容。

### 6.11 登录 / Auth

- 居中卡片 400 宽、radius-xl、`--admin-shadow`、无装饰渐变（现状 `radial-gradient` 可保留但压到 4% 强度，或改为纯 `bg`）。
- 结构：标记 + 标题（24/600）+ 一句说明（13 muted）+ 表单（控件 lg）+ 错误行（固定高度防跳动）+ 提交（block）。
- 初始化（setup）与登录共用同一版式，仅文案与按钮不同。

---

## 7. 暗色模式策略 / Dark Mode

### 7.1 机制 / Mechanism

保留现状的正确部分：

- **属性**：`<html data-scheme="light|dark">` + CSS `color-scheme`（原生控件、滚动条跟随）。
- **三态**：`light / dark / system`，`localStorage` 键 `admin.theme`；`system` 时监听 `prefers-color-scheme` 变化。
- **主题包**：亮/暗两套完整 token，内联写到 `<html>`，覆盖 `:root` 兜底。
- **图标**：`stroke="currentColor"`，天然双模（现状正确）。

需要改的：

1. **首帧不闪（P0-2）**。
2. **主题切换的可发现性**：三态循环 → 浮层三选一（见 4.7）。
3. **`meta[name=color-scheme]`** 已存在（`index.html:6`），保留；另加 `<meta name="theme-color">` 两套（可选用 `media` 属性），让移动端浏览器 UI 也跟随。

### 7.2 首帧不闪 / No FOUC

现状时序：`paint(loading)` → `await loadPacks()`（动态 `import`，可能几十毫秒到几百毫秒）→ `applyTheme()`。暗色用户在这段时间看到亮色兜底。

**方案（推荐）**：新增一个同源、阻塞、体积极小的 `client/scheme-boot.js`，在 `<head>` 中于样式表**之后**、`app.js` 之前同步加载：

```
<head>
  <link rel="stylesheet" href="/admin/assets/styles.css">   ← 已含亮/暗兜底 token
  <script src="/admin/assets/scheme-boot.js"></script>       ← 同步、无 defer（CSP 允许同源脚本）
</head>
```

`scheme-boot.js` 只做三件事（<300 字节）：读 `localStorage['admin.theme']` → 解析 `system` 为具体方案 → 写 `document.documentElement.dataset.scheme`。因为 `styles.css` 的 `:root[data-scheme='dark']` 已带完整暗色兜底，**首帧即是暗色**；主题包稍后到货只替换细微色值，不产生可感知翻转。

**为什么不用内联 `<script>`**：CSP `script-src 'self'` 不带 `'unsafe-inline'`，内联脚本会被拒。**为什么不改服务端渲染属性**：主题偏好只存在于 `localStorage`（无 cookie），服务端不知道；把偏好写 cookie 会引入新的状态面与隐私成本。

**验收**：把系统设为暗色 + 清空 localStorage → 首帧截图应无白色闪帧（DevTools 性能面板逐帧检查，或 10 次冷启动人工观察）。

### 7.3 暗色不只是反色 / Dark is not inverted

| 规则 | 做法 | 反例 |
| --- | --- | --- |
| 表面阶梯靠亮度 | `bg #0b0e12 → surface #11151b → surface-2 #171d25 → surface-3 #1d2530`，越"近"越亮 | 全部 `#000` / 全部 `#111` |
| 边框方向 | 暗色里边框比表面**更暗**或同族微亮（Tremor 用 `gray-900` 于 `#090E1A` 上）；本项目取"略亮"以保边界可辨（`#242c37` 于 `#11151b`） | 用亮色主题的 `#e3e7ec` 直接搬 |
| 文字不用纯白 | `#e9eef5`（≈93% 亮度），降低长时间阅读眩光 | `#ffffff` |
| 强调色提亮 | 亮色 `#1b5fc1` / 暗色 `#6ea8fe`，两套各自对底达标；`accent-text` 在暗色反转为深色（`#08111d`） | 深蓝底上仍用白字、或把亮色的深蓝直接搬到暗底 |
| 状态色重算 | ok/warn/danger/info 各出一套亮色系版本（而非调透明度） | `opacity: .8` 压暗 |
| 阴影 | 纯黑 + 更高不透明度 + 更小扩散；浮层同时保留边框 | 用亮色阴影（会在暗底留灰晕） |
| 柔和底 | `color-mix` 与**暗色表面**混合，不是与白色混合 | 固定 `rgba(37,99,235,.12)` |

### 7.4 对比度与可访问性目标 / Contrast

- 正文 ≥ 4.5:1；大字（≥18.66px 粗体 / 24px）≥ 3:1；状态色**作为文字**时 ≥ 4.5:1（故 5.1 的状态色选的是"深色可作文本色"的值）。
- 控件与卡片的边界**不承担唯一识别**（同时有填充底/图标/文字），因此边框不强制 3:1；但焦点环、当前项底、危险按钮等**承载语义的色块**必须 ≥3:1。
- 高对比变体（P3）：`<html data-contrast="high">` 时把 `--admin-muted` 抬到接近 `text`、边框转 `border-strong`、焦点环加粗到 3px（Linear 的 `contrast` 变量思路）。
- `forced-colors`（Windows 高对比模式）：确保边框与焦点使用系统色（`CanvasText`），不硬写颜色；至少不因 `background-image` 丢语义。
- 禁用"仅颜色"传达：状态徽标带文字与圆点，必填字段带 `*`，错误带图标。

### 7.5 测试矩阵 / Matrix

| 维度 | 组合 |
| --- | --- |
| 方案 | light / dark / system（跟随系统切换两次） |
| 语言 | zh / en（含最长键：`users.searchPlaceholder`、`roles.permissionsHint`） |
| 断点 | 1440 / 1280 / 1024 / 768 / 375 |
| 状态 | loading / empty / error / 100 行表格 / 长邮箱 / 无权限 |
| 环境 | 系统缩放 100% / 125% / 200%；`prefers-reduced-motion`；`prefers-contrast: more` |
| 主题包 | 默认包 / 故意缺 `ok` 的包（应告警且不崩）/ 空包（应回退兜底） |

---

## 8. 中英双语与排版 / Bilingual Typography

1. **语言键是唯一文案来源**：新增组件不允许硬编码中文或英文；缺键回退到键名（现状机制），便于发现漏翻。
2. **英文比中文长约 20–35%**：导航项不设固定宽（`flex: 1` + 省略 + `title`）；按钮用 `min-width` 而非 `width`；表格列头允许换行但行内数据不换行（`nowrap`）。
3. **中文排版**：`line-height: 1.5`（正文）、标题 `1.4`；**不加** `letter-spacing`；不用全大写；中英混排时在汉字与拉丁/数字间依赖字体默认间距，不手动插空格。
4. **英文排版**：分组标签全大写 + `.06em` 字距 + 11px；句子式大小写（Sentence case）用于页面标题与按钮，不用 Title Case。
5. **数字**：`font-variant-numeric: tabular-nums`；统计值、时间、ID 全部等宽；日期走 `Intl.DateTimeFormat(locale)`（现状 `formatDate` 已按 locale，保留并补 `hour/minute`）。
6. **排序与大小写**：搜索用 `toLocaleLowerCase()`（现状正确）；中文搜索不做拼音折叠（超范围，记为已知限制）。
7. **文案长度回归**：把 `en` 与 `zh` 两份字典的最长值写进测试（现有 `client.spec.ts` 可扩展），在 375 宽下断言无水平滚动。

---

## 9. 两个候选方向与取舍 / Two Directions

### 9.1 方向 A —「静默控制台 / Quiet Console」

**一句话**：把后台当成一件工具，而不是一个网站；层级全部由排版、间距和一条边框建立。

| 维度 | 选择 |
| --- | --- |
| 血缘 | shadcn/ui（骨架与控件档位）+ Linear（chrome 收敛、对齐）+ Vercel Geist（颜色=状态、表面/边框三档） |
| 侧栏 | 248 / 折叠 64 图标轨；分组标签极小；无背景图、无渐变 |
| 顶栏 | 52px，面包屑 + 3 个控件 + 头像菜单 |
| 内容 | max 1280，12 栅格，KPI 4 列，表格为主角 |
| 基准字 | 14px / 1.5；表格 13–14；标题 18 |
| 密度 | 控件 32、表格行 36、卡片内距 20 |
| 圆角 | 8（基准）/ 12（卡片）/ 999（徽标） |
| 阴影 | 仅浮层；卡片靠 1px 边框 |
| 强调色 | 单一蓝 `#1b5fc1 / #6ea8fe`（沿用现值）；状态色四枚 |
| 暗色 | **暗色优先校准**：先定暗色阶梯，再反推亮色 |
| 观感 | 冷静、紧凑、专业、长时间不累 |

**取舍**

- ✅ 实现成本最低：几乎全在现有 `styles.css` 内改 token 与组件规则，类名基本不变；无新 JS（除首帧脚本与主题浮层）。
- ✅ 表格容量最大：7 列在 1280 宽下无需横向滚动；行高 36 一屏可看 ~16 行。
- ✅ 主题包最稳：颜色少、派生多，换包不易翻车。
- ✅ 与"权限/审计"这类工具型后台的气质一致。
- ❌ 容易显得"冷"：需要靠空态插画、语气化文案、状态色点缀来补温度。
- ❌ 对排版纪律要求高：间距/字号一旦破格（比如又出现 18px padding），整体立刻显得散。
- ❌ 中文字号 13–14px 在部分 Windows 显示器 + 125% 缩放组合下偏小，需要实测并允许"舒适"密度档。
- ❌ KPI 只有数字，表达力弱于方向 B。

### 9.2 方向 B —「温和账本 / Calm Ledger」

**一句话**：把后台当成一份给人读的账本；用暖中性色、更大的呼吸、以及"数字 + 微图表"让信息自己说话。

| 维度 | 选择 |
| --- | --- |
| 血缘 | Tremor（KPI 卡 + 微可视化 + 汇总行）+ Tabler（页面骨架、四列 KPI、主题设置面板）+ daisyUI（语义色成对、三级表面） |
| 侧栏 | 264，分组 + 底部用户卡；可选折叠 |
| 顶栏 | 64px，标题 + 全局搜索 + 操作区 |
| 内容 | max 1180，卡片 2 列为主，KPI 卡带迷你条/进度环 |
| 基准字 | 15px / 1.5；标题 20–22 |
| 密度 | 控件 40、表格行 44、卡片内距 24 |
| 圆角 | 10（基准）/ 14（卡片）/ 999 |
| 阴影 | 卡片带极轻阴影（`0 1px 2px`）+ 边框 |
| 配色 | 暖中性（沙/石）+ 青绿强调 `#0f766e / #4fd1c5`，柔和底更明显 |
| 暗色 | 暖深灰（`#131411` 系），暗色与亮色**同时设计** |
| 观感 | 亲和、可信、适合低频操作者 |

**取舍**

- ✅ 更好读：大字号 + 大行高 + 微图表，对非技术管理员/年长用户更友好。
- ✅ KPI 表达力强：进度环、迷你条让"9 / 11 能力激活"一眼可懂。
- ✅ 空态与首次上手更容易写得温暖（这与"温和账本"的隐喻一致）。
- ❌ 表格容量下降约 25–30%：行高 44 + 15px 字，7 列表格在 1280 宽下会横向滚动或折行。
- ❌ token 与 CSS 量更大：多一套暖中性灰阶、更多柔和底、微图表样式；维护成本与回归面都上升。
- ❌ 暗色更难调：暖色在暗底上容易发脏，需要逐色校准；对比度达标的难度高于冷中性。
- ❌ 有"设计感过头"的风险：微图表一旦滥用就是装饰噪声，违背原则 1。

### 9.3 对照矩阵 / Comparison

| 维度 | A 静默控制台 | B 温和账本 |
| --- | --- | --- |
| 表格容量（7 列 @1280） | ✅ 无需横滚 | ⚠️ 需横滚或隐藏列 |
| 首屏信息量 | ✅ 高 | ⚠️ 中 |
| 长时间使用疲劳 | ✅ 低（暗色优先校准） | ⚠️ 中（暖色底在暗色下偏黄） |
| 非技术用户上手 | ⚠️ 中 | ✅ 高 |
| 实现成本（人力 / CSS 体量） | ✅ 低（~1.5 人日 token+shell） | ❌ 中高（~3 人日，含微图表） |
| 主题包稳定性 | ✅ 高（颜色少、派生多） | ⚠️ 中（柔和底与暖灰阶都要进包） |
| 双语适配 | ✅ 好（紧凑排版靠省略与 nowrap） | ⚠️ 英文长文案在大字号下更易挤 |
| 与现有代码距离 | ✅ 近（改 token 与规则即可） | ❌ 远（结构、间距、字号、组件都要动） |
| 失败模式 | 显得冷/寡淡 | 显得花/松散/暗色发脏 |

### 9.4 推荐 / Recommendation

**以 A 为骨、借 B 的四个零件**：

1. **A 的 token、栅格、密度、暗色优先校准**作为整体骨架。
2. 借 **B 的导航分组标签**（4.6）—— 5 个平铺项看起来像清单，分组后像产品。
3. 借 **B 的侧栏底部用户卡**（6.10）—— 顶栏因此少 2 个控件。
4. 借 **B 的柔和状态徽标**（6.7）—— 描边徽标在暗色下几乎不可见。
5. 借 **B 的空态写法**（6.9）—— 首屏零数据时，A 的克制会变成"空"。

**什么时候应该反过来选 B**：如果后续主要使用者是低频、非技术的运营/客服，且核心页面是"看报表"而非"改数据"，B 的舒适度收益会超过表格容量损失；此时建议保留 B 的密度，但把它的微图表限制在 KPI 行，不进表格。

---

## 10. 实施路径与验收 / Rollout & Acceptance

### 10.1 分期 / Phases

| 期 | 内容 | 产出 | 预估 |
| --- | --- | --- | --- |
| **P0 地基** | token v2（16 个）+ 派生变量 + 间距/字号/控件高度阶梯；侧栏/顶栏/内容区尺寸；首帧 `scheme-boot.js`；主题浮层三选一 | 视觉骨架到位，页面结构不变 | 1–1.5 人日 |
| **P1 组件** | 卡片、表格（sticky 头、hover 层、数字对齐、骨架、空态）、按钮五变体、表单字段、弹窗三段式、徽标六语气、Toast | 组件层可复用、可回归 | 2–3 人日 |
| **P2 页面** | 五个页面按 4.5 骨架重排；导航分组；用户卡；仪表盘 KPI + 最近审计/能力健康两栏 | 全部页面换新 | 2–3 人日 |
| **P3 打磨** | 高对比变体、密度开关、⌘K 搜索（可选）、`prefers-contrast`、动效细化、文案长度测试 | 收尾与可访问性 | 1–2 人日 |

### 10.2 兼容与回滚 / Compatibility

- **类名不重命名**（`.panel`/`.stat`/`.table`/`.button`/`.input`/`.badge` 全部保留），只加新类与改规则 → DOM 结构改动最小，回滚只需回退 CSS。
- 主题包 v2 为**加法**；旧包继续可用（缺 token 回退兜底 + 控制台告警）。
- 如需灰度：`<html data-shell="v2">` 下启用新规则，默认 `v1`，验收通过后切默认。

### 10.3 验收清单 / Acceptance checklist

- [ ] 对比度：正文/次要文字/状态文字 ≥4.5:1，大字与控件边界 ≥3:1（light + dark × zh + en）。
- [ ] 键盘：Tab 顺序合理、`:focus-visible` 可见、弹窗关闭后焦点回到触发按钮、侧栏折叠可用键盘展开。
- [ ] 200% 缩放与 375px 宽：无水平滚动、无文字裁切、表格可横滚且首列可辨。
- [ ] `prefers-reduced-motion`：无动画；`forced-colors`：边界与焦点仍可辨。
- [ ] 首帧：暗色系统下冷启动无白闪。
- [ ] 主题包：默认包 / 缺状态色的包 / 空包 三种情况都不崩、布局不变。
- [ ] 双语：两份字典最长值下布局不破；缺键显示键名（不偷偷回英文）。
- [ ] 性能：CSS ≤1200 行 / ≤40KB（未压缩）；100 行表格首屏 <100ms；无新增网络请求（除同源 `scheme-boot.js`）。
- [ ] CSP：无外链字体/图片/脚本；无内联脚本；控制台无 CSP 违规。
- [ ] 无新增依赖：`web/package.json` 的 `dependencies` 不变。

### 10.4 风险 / Risks

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `color-mix` 在老环境不支持 | 柔和底/焦点环失效 | `@supports` 降级到 `surface-2` |
| 14px 中文在 125% 缩放偏小 | 可读性投诉 | 提供"舒适"密度档（15px / 行高 40） |
| 全量重绘导致滚动位置丢失 | 换主题/语言后跳回顶部 | P2 记录 `content.scrollTop` 并在重绘后恢复；表格虚拟滚动不在本期 |
| 主题包生态被 v2 打破 | 第三方包失效 | 只加键、缺失回退、可选告警；不校验版本 |
| 微图表（若采用）引入绘制代码 | 体积与维护 | 只用 CSS 条形（无 SVG 图表库），限制在 KPI 行 |

---

## 11. 参考链接清单 / References

### 11.1 一手来源（官方文档 / 仓库 / 组件源码，已抓取正文）

| # | 来源 | 链接 | 用在本方案的哪一部分 |
| --- | --- | --- | --- |
| 1 | shadcn/ui · Dashboard Blocks | [https://ui.shadcn.com/blocks/dashboard](https://ui.shadcn.com/blocks/dashboard) | 侧栏宽/顶栏高变量、内容栅格、页面骨架（4.1/4.5） |
| 2 | shadcn/ui · Sidebar Blocks | [https://ui.shadcn.com/blocks/sidebar](https://ui.shadcn.com/blocks/sidebar) | inset 侧栏、面包屑顶栏、KPI 占位网格（4.1/4.7） |
| 3 | shadcn/ui · Theming | [https://ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming) | 语义 token 分类（5.1/5.8）；正文未抓全，结论以 registry 源码为准 |
| 4 | shadcn/ui · Dark Mode | [https://ui.shadcn.com/docs/dark-mode](https://ui.shadcn.com/docs/dark-mode) | 暗色属性策略（7.1）；正文未抓全 |
| 5 | shadcn/ui · Registry 组件源码（button / card / table / badge） | https://ui.shadcn.com/r/styles/new-york-v4/button.json · …/card.json · …/table.json · …/badge.json | 控件高度档、卡片内距、表格 padding、徽标圆角（2.1、5.6、6.x） |
| 6 | Tremor · 官网 | [https://www.tremor.so/](https://www.tremor.so/) | KPI 卡、微可视化、全局密度取向（6.2/6.3） |
| 7 | Tremor · Card | [https://www.tremor.so/docs/ui/card](https://www.tremor.so/docs/ui/card) | 卡片 `rounded-lg border p-6 shadow-xs` + 暗色底/边框（6.1） |
| 8 | Tremor · Table | [https://www.tremor.so/docs/ui/table](https://www.tremor.so/docs/ui/table) | 数字右对齐、汇总页脚、横滚容器（6.3） |
| 9 | Tremor · BarList | [https://www.tremor.so/docs/visualizations/barlist](https://www.tremor.so/docs/visualizations/barlist) | 固定行高条形列表（6.2） |
| 10 | Tabler · Color modes | [https://docs.tabler.io/ui/getting-started/color-modes](https://docs.tabler.io/ui/getting-started/color-modes) | 主题属性、auto 解析、FOUC 警告、折叠侧栏（4.2/7.2） |
| 11 | Tabler · Page layouts | [https://docs.tabler.io/ui/layout/page-layouts](https://docs.tabler.io/ui/layout/page-layouts) | page-header / page-body / 四列 KPI（4.5） |
| 12 | Tabler · Typography | [https://docs.tabler.io/ui/base/typography](https://docs.tabler.io/ui/base/typography) | `lead` 用次要色而非放大（5.5） |
| 13 | Tabler · GitHub | [https://github.com/tabler/tabler](https://github.com/tabler/tabler) | Tabler 定位（Bootstrap 系、100+ 页面、6,000+ 图标、暗色/RTL） |
| 14 | daisyUI · Themes | [https://daisyui.com/docs/themes/](https://daisyui.com/docs/themes/) | `data-theme`、`--prefersdark`、主题切换存 localStorage（7.1） |
| 15 | daisyUI · Colors | [https://daisyui.com/docs/colors/](https://daisyui.com/docs/colors/) | 语义色成对（`primary`/`primary-content`）、三级表面（5.1/5.8） |
| 16 | Vercel Geist · Colors | [https://vercel.com/geist/colors](https://vercel.com/geist/colors) | 表面/边框各三档、gray-alpha 仅用于浮层、半透明阴影（5.1/5.4） |
| 17 | Vercel Geist · Typography | [https://vercel.com/geist/typography](https://vercel.com/geist/typography) | 按用途命名的排版阶梯、Label 14、tabular 数字（5.5） |
| 18 | Linear · 新 UI 发布说明 | [https://linear.app/changelog/2024-03-20-new-linear-ui](https://linear.app/changelog/2024-03-20-new-linear-ui) | inverted-L chrome、噪音收敛、两套主题提高对比度（4.1/7.3） |
| 19 | Linear · How we redesigned the Linear UI | [https://linear.app/now/how-we-redesigned-the-linear-ui](https://linear.app/now/how-we-redesigned-the-linear-ui) | LCH、98→3 变量、contrast 变量、侧栏对齐（5.8/7.4/9.1） |

### 11.2 二手来源（仅用于交叉印证趋势）

| # | 来源 | 链接 | 说明 |
| --- | --- | --- | --- |
| 20 | AdminLTE · 10 Best SaaS Dashboard Design Examples & Trends (2026) | [https://adminlte.io/blog/saas-dashboard-design-examples/](https://adminlte.io/blog/saas-dashboard-design-examples/) | 内容营销博客；其"暗色优先 / 安静 chrome / 表格回归 / 颜色=含义"与本报告独立结论一致，未用于支撑任何数字 |
| 21 | RedwoodJS · Build Dashboards Fast with Tremor | [https://docs.redwoodjs.com/docs/8.7/how-to/build-dashboards-fast-with-tremor/](https://docs.redwoodjs.com/docs/8.7/how-to/build-dashboards-fast-with-tremor/) | 仅作 Tremor 使用面的旁证 |

### 11.3 作品站取样（正文不可抓取，仅标题级证据）

| # | 来源 | 链接 | 取证状态 |
| --- | --- | --- | --- |
| 22 | Dribbble · Analytics Dashboard UI/UX · Light & Dark Mode | [https://dribbble.com/shots/27071014--Analytics-Dashboard-UI-UX-Light-Dark-Mode-SaaS-Design](https://dribbble.com/shots/27071014--Analytics-Dashboard-UI-UX-Light-Dark-Mode-SaaS-Design) | HTTP 202 挑战页，正文未取到 |
| 23 | Dribbble · Vision Analytics Dashboard — Dark Mode Admin | [https://dribbble.com/shots/27457353-Vision-Analytics-Dashboard-Dark-Mode-Admin-Design](https://dribbble.com/shots/27457353-Vision-Analytics-Dashboard-Dark-Mode-Admin-Design) | HTTP 202，正文未取到 |
| 24 | Dribbble · BuiLD 2.0 Day 03 — Dark-Themed Neon Admin Dashboard | [https://dribbble.com/shots/21743254-BuiLD-2-0-Day-03-Dark-Themed-Neon-Admin-Dashboard](https://dribbble.com/shots/21743254-BuiLD-2-0-Day-03-Dark-Themed-Neon-Admin-Dashboard) | 仅搜索结果索引 |
| 25 | Behance · TechNova — Minimal Admin Dashboard UI | [https://www.behance.net/gallery/239941597/TechNova-Minimal-Admin-Dashboard-UI](https://www.behance.net/gallery/239941597/TechNova-Minimal-Admin-Dashboard-UI) | 连接被拒，正文未取到 |
| 26 | Behance · Buyur — Admin & Superadmin Dashboards | [https://www.behance.net/gallery/244093753/Buyur-Admin-Superadmin-Dashboards](https://www.behance.net/gallery/244093753/Buyur-Admin-Superadmin-Dashboards) | 连接被拒，正文未取到 |

### 11.4 未取证 / 排除

| 来源 | 链接 | 原因 |
| --- | --- | --- |
| Ant Design Pro 文档 | [https://pro.ant.design/docs/layout](https://pro.ant.design/docs/layout) | 302 到演示站，客户端渲染，抓取仅得标题；**未用于任何设计结论** |
| Ant Design Pro 演示站 | [https://preview.pro.ant.design](https://preview.pro.ant.design) | 同上 |
| daisyUI Admin 模板商店 | [https://daisyui.com/store/](https://daisyui.com/store/) | 仅导航可达，正文未取，未使用 |

---

## 附录 A · 现状 token → v2 token 对照 / Token mapping

| v1 | v2 | 变化 |
| --- | --- | --- |
| `--admin-bg` | `--admin-bg` | 值微调（`#f7f8fa` 保持） |
| `--admin-surface` | `--admin-surface` | 保持 |
| `--admin-surface-2` | `--admin-surface-2` | 值微调 |
| — | `--admin-surface-3` | **新增**：浮层底 / 行 hover |
| `--admin-border` | `--admin-border` | 变浅（只做分隔线） |
| — | `--admin-border-strong` | **新增**：控件边框 |
| `--admin-text` | `--admin-text` | 微调 |
| `--admin-muted` | `--admin-muted` | 保持 |
| — | `--admin-subtle` | **新增**：占位与 12px 注释 |
| `--admin-accent` | `--admin-accent` | 沿用 `#1b5fc1`（白字 6.1:1）；不为了让设计"看起来新"而换色 |
| `--admin-accent-text` | `--admin-accent-text` | 保持 |
| `--admin-danger` | `--admin-danger` | 保持（文字/填充共用，填充时用 `bg` 作字色） |
| （仅兜底）`--admin-ok` | `--admin-ok` | **入包** |
| （仅兜底）`--admin-warn` | `--admin-warn` | **入包** |
| — | `--admin-info` | **新增** |
| `--admin-radius` | `--admin-radius` | `10 → 8`（另有 `sm/lg` 派生） |
| `--admin-shadow` | `--admin-shadow` | 只给浮层；值改为双层低透明 |

## 附录 B · 关键改动清单（供评审对照，不含代码）

1. `styles.css`：token 块扩到 16 个 + 派生变量；引入间距/字号/控件高度刻度；重写 `.panel/.stat/.table/.button/.input/.badge/.toast/.dialog` 的规则；删掉 12 档字号与 2 档非标准字重（550/650）。
2. `index.html`：`<head>` 增加 `scheme-boot.js`（同源、同步）；补 `theme-color` meta。
3. `app.js`：`applyTheme` 提前（首帧前已由 boot 脚本兜住，`applyTheme` 仍负责写主题包 token）；`cycleTheme` 改为"设置具体值"；重绘前记录/恢复滚动位置（P2）。
4. `views.js`：`shellView` 增加分组与用户卡；`topBar` 收敛为面包屑 + 3 控件；表格增加骨架/空态/分页页脚；徽标改圆点 + 柔和底。
5. `ui/theme-default/client.js`：补齐 16 个 token（两套方案）。
6. `ui/locale-zh-en/client.js`：新增分组标签、表头、空态、分页、菜单等键（中英同时）。
7. `providers/nav-default`（可选）：`AdminNavContribution` 增加 `sectionKey`（additive）。
8. 契约文档：`plugins/admin/contract`、`ui-contract` 的 README 中记录 token v2 与 `sectionKey`。

## 附录 C · 与本项目既有文档的关系

- 平台总览：`docs/admin-platform.md`（中文见 `admin-platform.cn.md`）
- 系统设计：`docs/admin-system-design.md`（中文见 `admin-system-design.cn.md`）
- 本文只覆盖"界面层"；权限模型、能力目录、provider 契约以系统设计文档为准。

---

*本文所有结论均可回溯到文中链接或代码位置；Dribbble/Behance 与 Ant Design Pro 无法抓取正文的部分已标注为"未取证"，未用于支撑设计决策。*
