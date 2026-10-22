# @veren/person-agent-app

把 **Person Agent**（人机桥）暴露为一等 Veren 应用——应用即整栈：桥梁人设写在应用说明里，会话/工作区维护工具与 `renhua` 写作技能挂进每个页面会话的 agent 作用域，普通会话一个都看不到。

## 注册了什么

- **应用** `person-agent`（工具前缀 `person_agent`），入口页面 `overview`。
- **应用说明**（每个页面会话 PAGE 块的「应用说明」行）：桥梁人格——判断而非劳动；行动前先想「想」这件事；对任务归属有自己的判断，事实源是页面正文的三块名单；简体中文、结论先行；用 `session_create` + `session_dispatch` 派活；唯一的例外——给人看的文字由桥梁亲手写，且先加载 `renhua`。
- **页面**（自承载组件：模块级 PageFC，同步服务面在正文里直接读——每帧最新；异步面走 `ctx.page.effect` 拉取 + `useState`；无工厂、无快照契约）：
  - `overview` — `/apps/person-agent/overview`（入口）：一屏看清部署真实状态——应用目录、Workspace List、Agent Preset List、Model Catalog、待办任务（读取失败如实标注原因，绝不编造）。挂载十个工具：九个无状态工具走 `meta.tools` 静态面（`workspace_session_list`、`session_create`、`session_rename`、`session_archive`、`session_unarchive`、`session_pin`、`session_unpin`、`workspace_create`、`workspace_rename`），加上唯一的动态面——`session_dispatch` 经 `ctx.page.tool` 注册，携带随页面视图创建/销毁的结算看守。页面说明末尾是带数字的「停手派活」硬规则（连续 3 步以上只分析且没派活 → 立即停手派活）。
  - `workspaces` — `/apps/person-agent/workspaces`：正文直读工作区行；四个静态挂载工具（`workspace_session_list`、`session_create`、`workspace_create`、`workspace_rename`）；无动态注册。
- **页面级技能** `renhua`（人话写作）：随两页的 `meta.skills` 声明，由 app-host 挂进会话 agent 作用域（`ctx.skills.register`）；技能正文在包内 `skills/renhua/SKILL.md`。
- **工具目录**（市场/权限/发现的静态能力面）：全部十个工具，由兄弟工具包的构建器产出——与页面挂载的是同一份 `ToolDefinition`，绝不复制第二份实现。

## 依赖与失败语义（G13）

服务依赖全部是**声明的硬 inject**：`apps`、`pageRegistry`、`workspaceRegistry`、
`taskCenter`、`agentPresets`、`llm`，以及目录/动作工具执行时读取的
`sessions`/`sessionProjections`/`sessionController`；不做任何运行期探测。

页面组件在正文里**直接读**宿主服务面——同步面（`ctx.apps` / `ctx.workspaceRegistry`）正文直调、每帧最新；异步面（`ctx.taskCenter` / `ctx.agentPresets` / `ctx.llm`）`ctx.page.effect` 拉取、`useState` 落地，读取失败如实渲染。组件 ctx 携带完整宿主服务面（声明合并），页面不需要任何中介层。

- 目录与工作区是同步内存读，读取本身不会失败；
- 任务中心、预设名单、模型目录是异步读：读取失败时正文如实显示「任务中心读取失败：<原因>」/
  「预设名单读取失败：<原因>」/「模型目录读取失败：<原因>」——绝不假装有数据。模型目录的
  单个 provider 读取失败只影响该组，正文在该组行内标注原因。服务缺席不是可能的失败
  （硬 inject 保证在场）。

## 组合

经 `@veren/person-agent-bundle` 组合包安装：它的 patch 只插这一条应用行，应用框架经 `@veren/app-host-bundle` 依赖带入。preset 栈退役是 0.x 破坏性变更：以被删除的 `person-agent` 预设创建的旧会话无法恢复。

## 开发

```bash
pnpm --dir plugins/person-agent-app test        # vitest 单测
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
