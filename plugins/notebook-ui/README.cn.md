# @veren/notebook-ui

私密记事本的 Web 页面：侧栏入口、归属选择器、笔记列表，以及一个编辑器。

## 什么情况下用它

当 `@veren/notebook` 已安装，并且人需要在 DeepSeek Harness Web GUI 里浏览、新建、编辑、
删除每个预设的私密笔记时，用这个包。它是 `notebook_*` 工具所写同一份记录集合的人类半边。
无头、ACP 或 SDK profile 不需要它。

## 它带来什么

- 侧栏里的 **记事本** 入口（`order: 21`，排在论坛入口之后）。
- 一个完整的主面板页面：
  - **卡片画布**（默认面）：按类别与链接数把盒里的卡排到环上，关系用弯曲的边，悬停边
    点亮邻域，卡片可拖拽，滚轮缩放，闪念卡另有进料带；
  - 列表面（窄视口回退，也是无障碍等价面）；
  - 预设选择器（「记事本属于」），也会列出预设已删除但笔记仍保留的归属；
  - 笔记列表，显示标题、两行摘要、更新时间，以及每行的入链数角标（`⟲ n`）；
  - 编辑器：标题、正文、保存，以及需要点两次的删除；
  - 选中卡片的链接两段——出链与反链——选择变化即取，每个方向都有如实的空态；
  - 加载、空白、失败、重试、已保存与冲突的行内反馈。
- 由本插件挂载的 `notebook` 远端命名空间。宿主服务是 `@veren/notebook`；页面与工具调用
  同一批宿主方法。

本包只是面向人的 Web 面板。面向模型的应用层——agent 看到的 `/apps/notebook/...` 页面与
`notebook__*` 工具——位于 `@veren/notebook`（`src/app.ts`），且需要 app-hosting profile；
本包无需任何改动。

## 画布渲染

画布不是一块绝对定位的 DOM 卡片板：卡片图集画在一块 Konva 舞台（Canvas2D 场景图）上，
每条关系是一条贝塞尔路径，同时承担 1.6px 的墨线与 12px 的命中描边。画布没有 CSS 继承，
因此 `canvas-theme.ts` 用页面内的隐藏探针解析 `--nb-*` 别名（含 `color-mix`），并在
`body[data-ds-dark-theme]` 变化时重建调色板。拖拽位置只是视图态，按归属存进
localStorage；卡片的数据分文不动。

为什么：绝对定位 DOM 卡片把每张卡变成带折行、阴影与 transition 的 DOM 盒子，全部住在
一个被变换的世界里，于是每个拖拽帧都要重排子树，样式解析成了天花板。Konva 把命中测试、
拖拽阈值、文本折行与舞台平移缩放都做成了场景图原语。完整规格与取舍见
`docs/notebook-canvas-interaction.cn.md` §7。

`konva` 是构建期依赖：它被内联进 `lib/client.js`，装好的 profile 不会再拉第二份运行时副本。

## 安装

通过 `@veren/notebook-bundle` 安装整个技术栈。本包作为组合包的普通依赖随行，自身不声明
`dsh.bundle.patch`。浏览器半边是 `lib/client.js`，通过 `dsh.client` 声明，因此 Web 应用
无需重建 `apps/web` 就能加载它。

## 数据新鲜度

页面每 8 秒重读一次归属列表与当前记事本，并在每次写入后立刻重读。因此工具写入的内容会在
下一次轮询或按下 **刷新** 后出现；页面里的写入则立刻能被工具读到。页面只在草稿干净时跟随
外部修改，轮询永远不会覆盖人正在输入的文字。

## 开发

```sh
pnpm --dir plugins/notebook-ui typecheck
pnpm --dir plugins/notebook-ui test
pnpm --dir plugins/notebook-ui build
```

`scripts/bundle.mjs` 产出 `dist/index.js`（空的 Node Loader 行）与 `lib/client.js`（外壳
模块加载器封套里的浏览器模块）。
