---
title: 界面规范
description: "本章约束 Astro 开发期（development）对外呈现的两类界面：浏览器开发界面（开发工具栏与错误覆盖层）与终端界面（CLI 输出与交互提示）。设计依据只有两处源码事实：packages/astro/src/core/errors/overlay.ts（覆盖层全部 CSS 变量与行为）与 packages/astro/src/runtime/client/dev-toolbar/（工具栏与各 app 的 Shadow DOM 样式）；终端侧依据 core/messages/runtime.ts、cli/help/index.ts、core/logger/。凡源码中不存在的规则一律标“拟议”，无法从源码判断的标“待确认”"
sidebar:
  order: 23
  label: 界面规范
draft: false
lastUpdated: 2026-11-04
---

## 23. UI Specification

本章约束 Astro 开发期（development）对外呈现的两类界面：**浏览器开发界面**（开发工具栏与错误覆盖层）与**终端界面**（CLI 输出与交互提示）。设计依据只有两处源码事实：`packages/astro/src/core/errors/overlay.ts`（覆盖层全部 CSS 变量与行为）与 `packages/astro/src/runtime/client/dev-toolbar/**`（工具栏与各 app 的 Shadow DOM 样式）；终端侧依据 `core/messages/runtime.ts`、`cli/help/index.ts`、`core/logger/*`。凡源码中不存在的规则一律标“拟议”，无法从源码判断的标“待确认”。

开发期界面的三条硬边界：其一，两类界面都注入页面或终端，**不得干扰宿主内容**（工具栏 Shadow DOM 以 `all: initial` 隔离并延时 `requestIdleCallback` 初始化）；其二，**不得让开发者误判**（错误覆盖层是唯一权威的错误现场，工具栏只做提示，不替代终端输出）；其三，**不得增加站点负担**（图标只用内联 SVG，无网络字体、无媒体文件）。

### 23.1 Color Tokens

覆盖层令牌是唯一双主题色板（`:host` 为亮色，`:host(.astro-dark)` 为暗色）；工具栏没有主题切换，固定深色（`#13151A` 底 + `#343841` 边框），因此工具栏令牌单独成组。引用色值必须使用下表的语义名，不得在组件里写十六进制。

| 语义令牌 | 亮色（`:host`） | 暗色（`.astro-dark`） | 用途 |
| --- | --- | --- | --- |
| `--accent` | `#5f11a6` | `#c490f4` | 品牌强调、链接、主题球、语法关键字 |
| `--accent-hover` | `#792bc0` | `#deaaff` | 强调悬停 |
| `--background` | `#ffffff` | `#090b11` | 页面/覆盖层底 |
| `--box-background` | `#f3f4f7` | `#141925` | 消息、提示、栈、代码块等表面 |
| `--box-background-hover` | `#dadbde` | `#2e333f` | 表面悬停 |
| `--title-text` | `#090b11` | `#ffffff` | 标题与正文主色 |
| `--error-text` | `#ba1212` | `#f49090` | 错误标题/消息/错误行 |
| `--error-text-hover` | `#a10000` | `#ffaaaa` | 错误链接悬停 |
| `--success-text` | `#10b981` | `#10b981`（暗色沿用） | 复制成功对勾 |
| `--hint-text` | `#505d84` | `#a3acc8` | 提示区、辅助说明 |
| `--hint-text-hover` | `#37446b` | `#bdc6e2` | 提示链接悬停 |
| `--border` | `#c3cadb` | `#283044` | 装饰分隔线（见 23.1 末尾对比度说明） |
| `--stack-text` | `#3d4663` | `#c3cadb` | 栈帧正文 |
| `--misc-text` | `#6474a2` | `#8490b5` | 行号等次要标记 |
| `--toolbar-bg`（工具栏） | `#13151A`（渐变至 `rgba(19,21,26,.88)`） | 同左 | 工具栏与弹出窗口底 |
| `--toolbar-border`（工具栏） | `#343841` | 同左 | 工具栏/窗口/卡片描边 |
| `--toolbar-text`（工具栏） | `rgba(191,193,201,1)` | 同左 | 窗口正文 |
| `--toolbar-muted`（工具栏） | `rgba(145,152,173,1)` | 同左 | 链接、次要文案 |
| `--toolbar-accent`（工具栏） | `rgba(224,204,250,1)` | 同左 | 链接强调、代码着色 |
| 警告（无令牌，取通知色） | `#B58A2D` | 同左 | 工具栏通知 warning、终端 yellow |
| 错误通知 | `#B33E66` | 同左 | 工具栏通知 error |
| 信息通知 | `#3645D9` | 同左 | 工具栏通知 info |
| 禁用（拟议） | `--title-text` 35% 透明度 | 同左 | 现状仅 `data-app-error` 用 `opacity: .35` |
| 焦点（拟议） | `--accent`（9.9:1） | `--accent` | 现状覆盖层用 `--toggle-border-color` |

对比度实测（按 WCAG 相对亮度计算）：`--error-text` 对 `--background` ≈ 6.6:1；`--hint-text` 对 `--box-background` ≈ 5.9:1；`--toolbar-text` 对 `--toolbar-bg` ≈ 10.2:1。三处**不达标**已记录：亮色 `--misc-text` 对 `--box-background` ≈ 4.2:1（行号，需加深到拟议 `#55618c`，≈5.5:1）；暗色 `--border` 对 `--background` ≈ 1.5:1，只能作装饰分隔，若用于控件边界须改用拟议 `--border-strong: #5a6580`（≈3.0:1）；覆盖层主题开关焦点环 `#C3CADB` 对白底 ≈ 1.7:1，低于焦点指示 3:1，拟议统一为 `--accent`。

状态**不得只靠颜色**：工具栏通知点必须同时给 `aria-label`（“Audit：3 个无障碍问题”，拟议）；app 初始化失败除变红（`#ff252520`）外已把 tooltip 改为 `Error initializing ${app.name}`；表单勾选除配色外必须有 `::after` 滑块位移（现状已有）。

### 23.2 Spacing

基准 4px，实际取值 4/8/12/16/24/40/48，语义按“信息亲疏”分四档：

| 档位 | 取值 | 语义 | 源码实例 |
| --- | --- | --- | --- |
| 控件内 | 4 | 图标与文字、徽标内边距、提示条内距 | `.item-tooltip` padding `4px 8px`；`badge` padding `8px` |
| 相关字段 | 8 | 同组行距、标题与描述、区块内元素间距 | `h3` 与描述 `margin-bottom: 4px`+行高；窗口 section padding `8px` |
| 组件组 | 16 | 卡片内边距、消息区、按钮大号横向内距 | `astro-dev-toolbar-card` padding `16px`；`#message` gap `16px` |
| 页面区块 | 24 | 窗口内边距、区块分隔、布局行间距 | `astro-dev-toolbar-window` padding `24px`；`#layout` gap `24px` |
| 页面边距 | 40 / 48 | 覆盖层内容边距、标题上留白 | `#layout` padding `40px`；`#header` margin-top `48px` |

工具栏底部偏移同样按此推导：bar 高 40 + 下方 hitbox 16 = 56，窗口 `bottom: 72px` 即 56 + 16；左右贴边固定 16。禁止出现 2/6/10 这类非 4 倍数值；`#layout` 在 ≤768px 时 padding 归零属例外（靠窗口自身边距承担）。

### 23.3 Typography

字体族直接复用覆盖层已定义的两条栈：`--font-normal: system-ui, -apple-system, …, Arial, sans-serif`；`--font-monospace: ui-monospace, Menlo, Monaco, "Cascadia Mono", …, monospace`。工具栏窗口另用 `ui-sans-serif, system-ui, …`（含 emoji 回退字体，仅用于内容字符回退，**图标不得使用 emoji**）。终端不控制字体，只控制 ANSI 颜色与列宽。

| 档位 | 字号/行高 | 字重 | 颜色 | 实例 |
| --- | --- | --- | --- | --- |
| 页面标题 | 34 / 41 | 600 | `--title-text` | 覆盖层 `#title`（“An error occurred.”） |
| 区块标题 | 22 / 600（审计 24，代码 18） | 600 | `--title-text` | `#stack h2`、Audit `h1`、`#code h2` |
| 正文 | 16 / 26（窗口 14 / 1.5） | 400 | `--title-text` / `--toolbar-text` | `#message-content`、设置项描述 |
| 辅助 | 14 / 21 | 400 | `--hint-text` | `#hint-content`、`#stack-content` |
| 标签 | 12 | 400 | 徽标前景色 | `badge`、`.audit-selector` |
| 数据 | 12–14 等宽 | 400 | `--stack-text` / `--misc-text` | 行号、selector、props `pre` |
| 代码 | 14 / 21 等宽 | 400 | 语法变量 | `.shiki code`、`#code h2` |

折行与省略：短标签一律 `white-space: nowrap`（工具栏 tooltip、徽标、按钮）；代码文件名 `overflow-wrap: anywhere`（现状）；栈内容 `white-space: pre` + 横向滚动，不折行（保留缩进语义）；集成描述按字符截断到 90 字后加 `…`（现状用 JS 截断，拟议改为 CSS `text-overflow` 以支持 i18n 与缩放）。中文正文行宽不超过 40 个全角字（约 640px），与窗口最大宽一致。

### 23.4 Layout

覆盖层：`#backdrop` 固定全屏、`overflow-y: auto`；`#layout` 宽 1280、`max-width: min(100%, 1280px)`、`padding: 40px`、纵向 gap 24。工具栏：`#dev-toolbar-root` 固定 `bottom: 0`，三档位置由 `data-placement` 决定 —— `bottom-left`（`left: 16px`）、`bottom-center`（`left: 50%` + `translateX(-50%)`）、`bottom-right`（`right: 16px`）；bar 高 40、圆角 9999px、上方热区 42px、下方 16px。

弹出窗口（`astro-dev-toolbar-window`）固定 `bottom: 72px`、宽 `min(640px, 100%)`、`max-height: 480px`、圆角 12、padding 24、`z-index: 999999999`；审计窗口是例外：`width: 350px`、`top: 8px; right: 8px`、`max-height: 420px`，**不随 placement 移动**（与工具栏位置脱钩，待确认为有意设计）。箭头：现状窗口与工具栏之间只有 32px 空隙，**没有箭头**；拟议增加 8px 高、随 placement 翻转、与触发按钮水平对齐的箭头，仅作方向提示，不承担交互。

断点：`max-width: 1024px` 隐藏 Houston 插画与渐变叠层；`max-width: 768px` 覆盖层 padding 归零、主题开关改绝对定位、`#header` padding 12；`max-width: 640px` 窗口圆角归零（贴边全宽）。终端断点由 `process.stdout.columns` 决定：`< 60` 列时帮助表拆成两行（命令一行、说明缩进一行），`< 80` 列时 create-astro 的提示改为上下两行。

固定区域与滚动容器：`#backdrop`、`#stack-content`、`.shiki`（`max-height: 17rem`）、审计 `#audit-list`（`overscroll-behavior: contain`）、首页集成横滑区（`overflow-x: auto`）、设置窗口（整窗 `overflow-y: auto`）。滚动容器必须自带焦点或可聚焦内容，键盘用户才能滚动（拟议：给滚动容器加 `tabindex="0"` + `role="region"` + 可访问名称）。

键盘焦点管理：工具栏隐藏时 `bar-container` 加 `inert`、`dev-bar` 加 `tabindex="0"` 作为唯一可见把手；`mouseenter/focusin` 立即展开，`mouseleave/focusout` 延迟 2s 收起；`Esc` 先关闭当前 app，再隐藏整个工具栏（`document` 级 `keyup` 监听）。窗口打开**不移动焦点、不做焦点陷阱**（非模态）——拟议：打开后焦点进入窗口内首个可聚焦元素，`Esc`/外点关闭后焦点回到触发按钮。

### 23.5 Motion

时长与曲线取最小集（拟议统一，现状值在“现状”列）：

| 令牌 | 值 | 用途 | 现状 |
| --- | --- | --- | --- |
| `--motion-fast` | 100ms | 悬停底色、透明度、焦点环 | 现有 `0.2s ease-out` |
| `--motion-base` | 150ms | 进入：tooltip/窗口/通知点淡入 | 现有 `0.2s ease-in-out` |
| `--motion-slow` | 200ms | 离开：tooltip 淡出、窗口收起 | 现有 `0.2s` |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | 默认 | 现有 `ease` |
| `--ease-enter` | `cubic-bezier(0,0,0,1)` | 元素出现 | 无 |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | 元素消失 | 无 |

| 组件 | 触发 | 变化属性 | 时长/曲线 | 可中断 | reduced-motion 降级 |
| --- | --- | --- | --- | --- | --- |
| ToolbarBar 显隐 | hover/focusin、2s 后淡出、Esc | `bottom`（40→0 位移） | 现状 350ms `cubic-bezier(.485,-.05,.285,1.505)`（回弹） | 是（clearTimeout） | 去掉回弹，改为透明度跳变 |
| ToolbarButton 悬停 | `:hover`/`:focus-visible` | `background` | 现状即时 | 是 | 保留（颜色变化非动画） |
| ToolbarTooltip | 悬停 200ms 后 | `opacity` 0→1 | 200ms ease-in-out（追加 200ms 延迟） | 是 | 直接显示 |
| 窗口开合 | app 按钮切换 | `display` 硬切 | 无动画 | — | 拟议 150ms 淡入 + 4px 上移 |
| 复制反馈 | 点击复制 | 图标↔对勾、颜色→`--success-text` | 2s 后复位（首页 3.5s） | 是（重开计时） | 保留（属状态替换） |
| ToolbarToggle | 勾选 | `background-color`、`transform: translateX(12px)` | 0.2s ease | 是 | 保留位移但去掉过渡 |
| OverlayThemeToggle | 勾选 | 球位移 28.5px、图标颜色 | 0.5s `cubic-bezier(.23,1,.32,1)` | 是 | 直接跳变 |
| 集成骨架屏 | 加载中 | `opacity` 1→.5 | 2s 循环 + 每卡 250ms 错峰 | 否（循环） | 停用动画，仅保留静态骨架 |
| 错误覆盖层出现 | 编译/运行错误 | 无动画（直接插入） | — | — | 拟议 150ms 淡入 |

原则：只动 `opacity`/`transform`/颜色，不动尺寸与位置（避免布局跳动）；动画不做输入阻塞（无 `pointer-events` 锁定）；循环动画只允许出现在“加载中”骨架屏，且 `prefers-reduced-motion: reduce` 时必须停。

### 23.6 Microcopy

按钮用动词开头、错误提示三段式（发生了什么／为什么／下一步）、成功反馈用短句 + 可逆提示。下表“现状”列均为源码原文，中文为目标语言（zh-CN）拟议译文。

| 场景 | 现状文案（英文） | zh-CN 拟议 | 规则 |
| --- | --- | --- | --- |
| 工具栏应用名 | `Menu` / `Audit` / `Inspect` / `Settings` / `More` | 菜单／审计／检查／设置／更多 | 名词，≤6 字 |
| 无岛空态 | `No islands detected.` | 未检测到岛屿组件。 | 结论句 + 下一段解释 |
| 空态解释 | `It looks like there are no interactive component islands on this page. Did you forget to add a client directive to your interactive UI component?` | 本页没有可交互的岛屿组件。是否忘记给交互组件添加客户端指令？ | 原因 + 反问式下一步 |
| 审计空态 | `No accessibility or performance issues detected.` | 未检测到无障碍或性能问题。 | 结论句 |
| 审计空态补充 | `Nice work! This app scans the page and highlights common accessibility and performance issues for you, like a missing "alt" attribute on an image, or an image not using performant attributes.` | 做得不错！本应用会扫描页面并高亮常见问题，例如图片缺少 `alt` 属性，或图片未使用性能更好的属性。 | 举例说明范围 |
| 复制失败堆栈 | （仅图标，无文案） | 复制错误 | 拟议补 `aria-label` 与 tooltip |
| 复制成功 | `Copied to clipboard!` | 已复制到剪贴板 | 3.5s 后复位 |
| 设置项 | `Disable notifications` / `Verbose logging` / `Placement` | 停用通知 / 详细日志 / 位置 | 标签名词化，描述句说明结果 |
| 设置项描述 | `Hide notification badges in the toolbar.` | 隐藏工具栏上的通知徽标。 | 说“结果”不说“实现” |
| 隐藏工具栏引导 | `Run astro preferences disable devToolbar in your terminal to disable the toolbar.` | 在终端运行 `astro preferences disable devToolbar` 可停用工具栏。 | 给出可复制命令 |
| app 初始化失败 | `Error initializing ${app.name}` | 无法初始化 {app} | 已发生 + 对象 |
| 覆盖层标题 | `An error occurred.` / `Stack Trace` / `Cause` | 发生错误／调用栈／原因 | 固定名词 |
| 覆盖层动作 | `See Docs Reference` / `Open in editor` | 查看文档／在编辑器中打开 | 动词短语 |
| 终端就绪 | `astro v7.4.5 ready in 123 ms` | 同左（命令输出不翻译） | 终端输出保持英文 |
| 终端构建 | `7 page(s) built in 1.23s` / `Complete!` | 同左 | 现状 `page(s)` 为粗暴复数，拟议用 `Intl.PluralRules` |
| 终端错误 | `Hint:` / `Error reference:` / `Stack trace:` / `Caused by:` | 同左 | 分组标题后跟内容 |

确认弹窗只用于破坏性操作（现状开发期无破坏性弹窗；`astro add` 的覆盖写配置文件应弹确认，`--yes` 跳过 —— 拟议）。成功反馈必须紧邻触发点（复制按钮原位变形），不得用全屏 toast 抢焦点。

### 23.7 Accessibility

对比度：正文与图标文字 ≥ 4.5:1，大字（≥18.66px 粗体或 ≥24px）≥ 3:1，焦点环与控件边界 ≥ 3:1。已知缺口见 23.1（行号、暗色边框、焦点环），修复前不得在验收里标记通过。焦点可见：统一 `outline: 2px solid` + `outline-offset: 2px`（现状覆盖层主题开关为 `2px` / offset `4px`，工具栏依赖 UA 默认并 `outline-offset: -3px`）。

焦点顺序：工具栏按钮按视觉从左到右（内置 → 自定义 → More → Settings），窗口内容按 DOM 顺序；隐藏态用 `inert` 把整条 bar 移出 Tab 序，`dev-bar` 自身 `tabindex="0"` 保证仍可用键盘唤出。跳过导航：开发界面不插入站点内容流，站点自身的跳转链接不受影响（不适用自建跳转链接，依据：工具栏挂在 `body` 末尾且 Shadow DOM 隔离）。

图标按钮可访问名称：ToolbarBar 的每个条目是 `<button>`，内含可见 tooltip 文本，天然获得名称（现状合格）；覆盖层复制按钮是 `<span id="copy-btn" onclick>`，不可聚焦且无名称（**不合格**，拟议改 `<button type="button" aria-label="Copy error">`）。表单关联：设置项用 `<label class="setting-row">` 包住标题、描述与自定义开关，但开关的真实 `<input>` 在 Shadow DOM 内，标签文本未与控件建立程序化关联（拟议 `aria-describedby` 指向描述、`aria-labelledby` 指向 `h3`）。窗口语义：现状无 `role`/`aria-modal`，拟议非模态窗口用 `role="dialog" aria-modal="false"` + `aria-labelledby` 指向标题；覆盖层是全屏接管，拟议 `role="alertdialog" aria-modal="true"` + 初始焦点落在标题、`Esc` 关闭需产品确认（现状 `close()` 只被内部调用）。键盘：`Tab`/`Shift+Tab` 遍历，`Esc` 逐级关闭，列表内方向键（审计列表现状无 roving tabindex，拟议上下键在条目间移动、`Enter` 定位高亮）。

### 23.8 Internationalization

目标语言 zh-CN + en。现状：**全部界面文案仅英文**（工具栏 app 名、设置项、空态、覆盖层、CLI 输出），无语言协商、无 RTL 支持（覆盖层硬编码 `this.dir = 'ltr'`），属待改进项，本章所有中文均为“拟议”。文案长度按英文 +30% 预留：工具栏条目固定 44px，中文 tooltip 允许 2 行；按钮设 `min-width: 44px`（触控下限）、`max-width: 160px`，超出省略并保留 `title`。数字/日期/复数一律走 `Intl`：终端时间戳已用 `Intl.DateTimeFormat([], { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })` 跟随系统区域；`page(s) built in` 拟议改 `Intl.PluralRules`；端口、耗时、页数用 `Intl.NumberFormat`。字体回退：zh-CN 需在 `--font-normal` 前追加 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC"`，等宽栈追加 `"Sarasa Mono SC"`；断行用 `line-break: normal` + `overflow-wrap: break-word`，只有代码/路径保留 `anywhere` 与横向滚动。终端输出不做翻译（开发者工具惯例），仅保证 CJK 宽度对齐：帮助表按显示宽度而非 `String.length` 计算 padding（拟议）。

### 23.9 Icons

全部为内联 SVG：工具栏图标 20×20（`#dev-bar .item .icon>svg`），覆盖层动作图标 16×16，覆盖层提示/复制/警示 24×24，高亮角标 24×24，Houston 插画 175×131（纯装饰）。描边基准 1.5（覆盖层 Tabler 线性图标），实心图标（Astro logo、Audit、Inspect）用 `fill`。颜色优先 `currentColor`；现状部分图标写死 `fill="#fff"`（Audit/Inspect/Home logo），拟议改 `currentColor` 并保留 `@media (forced-colors: active)` 下的黑色回退。装饰性图标必须 `aria-hidden="true"`（现状已普遍具备）；语义图标（应用入口、复制、主题切换）必须由宿主按钮提供可访问名称，不得只靠图形。禁止 emoji、禁止图标字体、禁止位图图标。

### 23.10 Media and Theme

图片：覆盖层无内容图片（Houston 为内联 SVG，`aria-hidden`）；工具栏外壳无图片；仅 Home 应用的“Featured integrations”卡片可能渲染远程集成 logo（`img` 元素 24×24，`alt` 取集成标题 —— 现状合格），该请求指向 `https://astro.build/api/v1/dev-overlay/`，属唯一外网依赖，离线时骨架屏会一直存在（拟议加载失败给出“无法加载集成列表”与重试）。视频/音频：两类界面均不涉及，**不适用**（依据：`overlay.ts` 与 `dev-toolbar/**` 中无 `video`、`audio` 元素或 `Audio()` 调用）。自定义滚动条：仅 Home 集成横滑区用 `::-webkit-scrollbar`（宽 5/高 8、拇指 `rgba(255,255,255,.3)`、两端渐隐遮罩），Firefox 无效果；拟议补 `scrollbar-width: thin` + `scrollbar-color`，其余容器保持原生滚动条。

主题：覆盖层双主题由 `--*` 变量整组切换，优先级为 **localStorage `astroErrorOverlayTheme` > `prefers-color-scheme` > 亮色**；构造时同步读 `localStorage` 并立刻给宿主加 `.astro-dark`，在首次绘制前完成，**不闪烁**；切换开关回写 `localStorage`，不监听系统变化（拟议：未手动选择时监听 `change`）。工具栏固定深色、不随站点主题变化（Shadow DOM + `all: initial` 隔离，且设置窗口显式 `color-scheme: dark`）；“工具栏跟随站点视觉”为**拟议**能力，落地时须为每个窗口声明 `color-scheme` 并重新校验对比度。强制配色（`forced-colors: active`）下已有回退：bar/窗口背景转白、图标填充转黑、主题球用 `SelectedItem`。

### 23.11 Acceptance

| ID | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-23-01 | 暗色系统偏好、无 localStorage | 触发一个编译错误 | 覆盖层直接以暗色呈现，无白闪；主题开关为选中态 |
| A-23-02 | 亮色覆盖层 | `Tab` 到主题开关 | 焦点环 ≥2px、对比度 ≥3:1、可见 |
| A-23-03 | 任意页面 | 悬停工具栏 2s 后移开 | 2s 后收起；期间移回不收起；`Esc` 同样收起 |
| A-23-04 | 打开 Audit 窗口 | 点击页面空白处 | 窗口关闭（外点），焦点回到 Audit 按钮（拟议项需实现后才通过） |
| A-23-05 | 系统开启“减少动态效果” | 反复开关窗口/主题 | 无位移与循环动画，仅瞬时状态变化 |
| A-23-06 | 窗口宽 360px | 打开各窗口 | 无横向滚动；窗口贴边、圆角 0；按钮仍可点 |
| A-23-07 | 审计结果含 3 条 | 读屏浏览工具栏 | 通知点播报“3 个问题”，不只靠颜色 |
| A-23-08 | 终端 60 列以下 | `astro --help` | 帮助表拆行，不错位、不折行溢出 |
