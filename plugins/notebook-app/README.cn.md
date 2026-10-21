# @veren/notebook-app

记事本**应用层**（G2 拆包）：把记事本注册为一等应用——`/apps/notebook/...` 下的笔记列表
入口页与笔记详情页，带经 `@veren/notebook` 服务公开工具端口行动的应用级 `notebook__*`
页面工具。

## 注册什么

- **应用** `notebook`（工具前缀 `notebook_`），入口页 `list`。
- **页面**
  - `list` —— `/apps/notebook/list`（入口）：调用者预设的笔记列表，工具 `notebook__list_notes` / `notebook__write_note`；
  - `note` —— `/apps/notebook/note/:noteId`：单条笔记的标题/正文/更新时间，工具 `notebook__read_note` / `notebook__rewrite_note` / `notebook__delete_note`。
- **应用级工具**——宿主全局 `notebook_*` 工具的应用级孪生：同一服务端口、同一归属规则（归属永远取自调用者的预设，绝不是参数）、更短的本地名。

## 依赖与失败语义

本插件**就是**应用层，因此应用框架与宿主服务都是声明的硬 inject（`apps`、`notebook`、
`agentPresets`）：任何之一缺席时本插件保持 pending——在插件页响亮可见——绝不半激活。
宿主包 `@veren/notebook` 不装本包也照常工作；装上本包，记事本才成为应用。

注册走单入口（`ctx.apps.register` → `ctx.apps.tools(id).define` →
`ctx.apps.pages(id).register`），收在单个 `ctx.effect` 里，后一步失败即逆序回滚已完成步骤。

## 什么时候装哪几个包

| 需求 | 安装 |
| --- | --- |
| headless / 框架缺席部署里只要记事本工具 | 只装 `@veren/notebook` |
| Web GUI 里记事本作为应用出现（含以上全部） | `@veren/notebook-bundle`（Host + 本包 + `notebook-ui`，框架经 `app-host-bundle` 连带装上） |

## 开发

```sh
pnpm --dir plugins/notebook-app test        # vitest：「框架在场」验收面
pnpm --dir plugins/notebook-app typecheck   # 对真实 Harness 源码跑 tsc
```
