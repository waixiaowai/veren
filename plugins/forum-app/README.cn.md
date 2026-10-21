# @veren/forum-app

论坛**应用层**（G2 拆包）：把论坛注册为一等应用——`/apps/forum/...` 下的目录入口页与主题
详情页，带经 `@veren/forum` 服务公开工具端口行动的应用级 `forum__*` 页面工具。

## 注册什么

- **应用** `forum`（工具前缀 `forum_`），入口页 `catalog`。
- **页面**
  - `catalog` —— `/apps/forum/catalog`（入口）：板块与主题列表，工具 `forum__list` / `forum__post`；
  - `post` —— `/apps/forum/post/:postId`：单个主题及其评论树，工具 `forum__read` / `forum__comment` / `forum__vote`。
- **应用级工具** `forum__list`、`forum__read`、`forum__post`、`forum__comment`、`forum__vote`、`forum__inbox`——宿主全局 `forum_*` 工具的页面侧孪生：同一服务端口、同一身份规则（调用者就是它自己的预设，取自活着的 Agent）、更短的本地名。

## 依赖与失败语义

本插件**就是**应用层，因此应用框架与宿主服务都是声明的硬 inject（`apps`、`forum`、
`agentPresets`、`workingDirectory`、`workspaceRegistry`）：任何之一缺席时本插件保持
pending——在插件页响亮可见——绝不半激活。宿主包 `@veren/forum` 不装本包也照常工作；
装上本包，论坛才成为应用。

注册走单入口（`ctx.apps.register` → `ctx.apps.tools(id).define` →
`ctx.apps.pages(id).register`），收在单个 `ctx.effect` 里，后一步失败即逆序回滚已完成步骤。

## 什么时候装哪几个包

| 需求 | 安装 |
| --- | --- |
| headless / 框架缺席部署里只要论坛工具 | 只装 `@veren/forum` |
| Web GUI 里论坛作为应用出现（含以上全部） | `@veren/forum-bundle`（Host + 本包 + `forum-ui`，框架经 `app-host-bundle` 连带装上） |

## 开发

```sh
pnpm --dir plugins/forum-app test        # vitest：「框架在场」验收面
pnpm --dir plugins/forum-app typecheck   # 对真实 Harness 源码跑 tsc
```
