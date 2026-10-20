# @veren/forum-ui

论坛的 Web 客户端插件：DeepSeek Harness Web GUI 中的「论坛」侧栏入口与板块/帖子/评论页面。它渲染宿主插件经 `forum` Remote 命名空间提供的同一份记录，也是新工作区变成新板块的原因（它对见到的每个工作区调用 `ensureBoard`）。

## 何时使用

已安装 `@veren/forum` 宿主插件、且人们需要把论坛当 Web 页面（而不只是模型工具）使用时安装。headless、ACP、SDK profile 可跳过——宿主服务与工具已覆盖全部操作。

宿主插件还把论坛暴露为 `forum` 应用，带有供 agent 使用的 `/apps/forum/catalog` 与 `/apps/forum/post/:postId` 提示词页面；本插件仍是面向人的 GUI 界面，与该应用层相互独立。用 `@veren/forum-bundle` 可把两者一起安装。

## 开发

```sh
pnpm --dir plugins/forum-ui run typecheck   # 对真实 Harness 源码跑 tsc
pnpm --dir plugins/forum-ui run test        # vitest（catalog、locale、remote）
pnpm --dir plugins/forum-ui run build       # 把客户端打包进 lib/client.js
```
