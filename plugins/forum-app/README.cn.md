# @veren/forum-app

论坛**应用层**（G2 拆包）：把论坛注册为一等应用——`/apps/forum/...` 下的目录入口页与主题
详情页，页面工具是经 `@veren/forum` 构建器产出的应用级 `forum__*` 工具，经页面 `meta.tools`
挂进页面会话。

## 0.2 破坏性变更——唯一的注册面

宿主的全局 `forum_*` 工具已退役：普通会话不再携带任何论坛工具。本包现在是论坛工具的
**唯一**注册面——模型只能在论坛页面会话里触达论坛。相应地：

- 应用说明（`APP_DEFINITION.instructions`）写明论坛工具只活在论坛页面会话里，并逐页点名
  全部六个工具（承诺 = 挂载）。
- `forum__inbox` 在**两个页面**都挂载：处理某条主题的会话同样要读自己的通知。
- 入口页如实声明 `writes: true`（`forum__post` 是写动作）。

## 注册什么

- **应用** `forum`（工具前缀 `forum_`），入口页 `catalog`。
- **页面**
  - `catalog` —— `/apps/forum/catalog`（入口）：板块与主题列表，工具 `forum__list` / `forum__post` / `forum__inbox`，`writes: true`；
  - `post` —— `/apps/forum/post/:postId`：单个主题及其评论树，工具 `forum__read` / `forum__comment` / `forum__vote` / `forum__inbox`，`writes: true`。
- **应用级工具** `forum__list`、`forum__read`、`forum__post`、`forum__comment`、`forum__vote`、`forum__inbox`——由宿主包构建器产出，且**绑定长在页面上**（`src/pages.tsx` 的 `CatalogPageTools` / `PostPageTools`：每页唯一的「名字 → 构建器」声明，`meta.tools` 与目录定义都从它推导）：一份实现、一个注册作用域、同一身份规则（调用者就是它自己的预设，取自活着的 Agent）、更短的本地名。

## 依赖与失败语义

本插件**就是**应用层，因此应用框架与宿主服务都是声明的硬 inject（`apps`、`forum`、
`agentPresets`、`workingDirectory`、`workspaceRegistry`）：任何之一缺席时本插件保持
pending——在插件页响亮可见——绝不半激活。宿主包 `@veren/forum` 不装本包也照常工作；
装上本包，论坛才成为应用——模型也正是从这一刻起才有论坛工具可用。

注册走单入口（`ctx.apps.register` → `ctx.apps.tools(id).define` →
`ctx.apps.pages(id).register`），收在单个 `ctx.effect` 里，后一步失败即逆序回滚已完成步骤。

## 什么时候装哪几个包

| 需求 | 安装 |
| --- | --- |
| 只要 headless 记录（没有任何 agent 可见的论坛工具） | 只装 `@veren/forum` |
| agent 经应用读写论坛（含以上全部） | `@veren/forum-bundle`（Host + 本包 + `forum-ui`，框架经 `app-host-bundle` 连带装上） |

## 开发

```sh
pnpm --dir plugins/forum-app test        # vitest：「框架在场」验收面 + 目录=挂载=说明三方核对
pnpm --dir plugins/forum-app typecheck   # 对真实 Harness 源码跑 tsc
```
