# person-agent（ZCode 插件）

DSH person-agent 套件（`plugins/person-agent-app`、`person-agent-bundle`、`person-agent-tool-session`、`person-agent-tool-workspace`）的 ZCode 移植版：一个大管家——判断请求、把劳动派给后台子代理、用平实中文汇报结果。

## 注册了什么

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| 子代理 `person-agent` | `agents/person-agent.md` | 桥梁人格：判断而非劳动，经 Agent 工具以 `run_in_background: true` 派活，核验并转述结果，给人看的文字亲手写 |
| 技能 `dispatch` | `skills/dispatch/SKILL.md` | 何时派、怎么派：一张派单一个目标、派单写用户的话、"连续 3 步只分析就停手派活"硬规则 |
| 技能 `renhua` | `skills/renhua/SKILL.md` | 给人看的中文写作规矩 |
| 命令 `/person-agent` | `commands/person-agent.md` | 把当前请求端到端交给大管家 |

## 为什么是一个插件而不是四个

DSH 那套拆成两个工具库、一个应用、一个组合包，是因为 cordis 按层加载 patch。ZCode 插件是一份自承载清单（`skills` / `agents` / `commands`），没有可组合的层——整栈就是一份 `plugin.json`。

两项 DSH 能力在 ZCode 里没有对面的接口，缺度而不造假：

- **会话工具**（`session_create` / `session_dispatch` / `session_archive`……）——ZCode 不向插件暴露会话注册表。原生等价物是 Agent 工具 + 后台子代理；`dispatch` 技能承载同样的语义（派完立即返回、靠任务通知结算、不轮询）。
- **工作区工具**（`workspace_create` / `workspace_session_list`……）——ZCode 的工作区就是打开的目录，没有可维护的注册表。因此不声明 MCP 服务器：没有它真正能服务的资源。

## 安装（本地开发市场）

在 **Plugin Marketplace → Add** 里添加市场根目录 `C:\Users\imeep\Documents\cursour\plugins`，然后从 `dev-cursour` 市场安装 **Person Agent**。装好后：在输入框的代理选择器里选 `person-agent`，或输入 `/person-agent <目标>`，或直接让主对话"让管家来办"。

## 试一句

> /person-agent 把仓库 README 改写成平实的中文，并检查 CI 配置里有没有过时脚本，两件都汇报。

预期：大管家把两件独立的活并行派给后台子代理（README 属于"给人看的文字"，由它亲手写并先过写作规矩），每件派出用一句实话交代去了哪、为什么；结果核验后转述，并给出下一步。

## 开发

纯声明式资源——没有构建步骤。改 markdown 文件，然后从市场刷新/重装插件即可生效。
