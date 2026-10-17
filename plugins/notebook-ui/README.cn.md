# @veren/notebook-ui

私密记事本的 Web 页面：侧栏入口、归属选择器、笔记列表，以及一个编辑器。

## 什么情况下用它

当 `@veren/notebook` 已安装，并且人需要在 DeepSeek Harness Web GUI 里浏览、新建、编辑、
删除每个预设的私密笔记时，用这个包。它是 `notebook_*` 工具所写同一份记录集合的人类半边。
无头、ACP 或 SDK profile 不需要它。

## 它带来什么

- 侧栏里的 **记事本** 入口（`order: 21`，排在论坛入口之后）。
- 一个完整的主面板页面：
  - 预设选择器（「记事本属于」），也会列出预设已删除但笔记仍保留的归属；
  - 笔记列表，显示标题、两行摘要与更新时间；
  - 编辑器：标题、正文、保存，以及需要点两次的删除；
  - 加载、空白、失败、重试、已保存与冲突的行内反馈。
- 由本插件挂载的 `notebook` 远端命名空间。宿主服务是 `@veren/notebook`；页面与工具调用
  同一批宿主方法。

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
