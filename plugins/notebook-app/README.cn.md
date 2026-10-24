# @veren/notebook-app

记事本**应用层**（G2 拆包），也是记事本**唯一的注册面**：把记事本注册为一等应用——
`/apps/notebook/...` 下的笔记列表入口页与笔记详情页，带经 `@veren/notebook` 服务公开
工具端口行动的应用级 `notebook__*` 页面工具。

## 注册什么

- **应用** `notebook`（工具前缀 `notebook`），入口页 `list`。
- **页面**
  - `list` —— `/apps/notebook/list`（入口）：调用者预设的笔记列表，工具 `notebook__list_notes` / `notebook__write_note`；
  - `note` —— `/apps/notebook/note/:noteId`：单条笔记的标题/正文/更新时间，工具 `notebook__read_note` / `notebook__rewrite_note` / `notebook__delete_note`。
- **应用级工具**——`@veren/notebook` 的五个构建器（唯一的面向模型实现）：注册时以全名
  `notebook__<本地名>` 备好，经 `bindNotebookServices` 绑进页面模块槽位；各页组件体在唯一一次
  渲染里经 `agent.ctx.tools.register` 自行登记（随 agent fiber 生灭）；绝不注册进
  `ctx.tools`。归属规则一如既往：归属永远取自调用者的预设，绝不是参数。

## 承诺对齐（§3.9）

目录面、逐页挂载面与说明的措辞是同一件事：目录里的每个工具恰好挂在一页上，挂载的每个
工具都被该页说明点名，说明也绝不答应页面没有的工具。三个方向都由 `tests/app.spec.ts`
钉死。

## 依赖与失败语义

本插件**就是**应用层，因此应用框架与宿主服务都是声明的硬 inject（`apps`、`notebook`、
`agentPresets`）：任何之一缺席时本插件保持 pending——在插件页响亮可见——绝不半激活。
宿主包 `@veren/notebook` 不装本包也照常工作，但 0.2.0 起它不注册任何工具；没有本包，
任何 agent 都够不到记事本。装上本包，记事本才成为应用。

注册走单入口（`ctx.apps.register` → 工具以全名备好并绑进页面模块槽位 →
`ctx.apps.pages(id).register`），收在单个 `ctx.effect` 里，后一步失败即逆序回滚已完成步骤。

## 什么时候装哪几个包

| 需求 | 安装 |
| --- | --- |
| 只要记事本领域、无任何面向模型的工具（headless / 框架缺席部署） | 只装 `@veren/notebook` |
| Web GUI 里记事本作为应用出现，agent 经 `/apps/notebook` 页面会话使用它 | `@veren/notebook-bundle`（Host + 本包 + `notebook-ui`，框架经 `app-host-bundle` 连带装上） |

## 开发

```sh
pnpm --dir plugins/notebook-app test        # vitest：「框架在场」验收面
pnpm --dir plugins/notebook-app typecheck   # 对真实 Harness 源码跑 tsc
```
