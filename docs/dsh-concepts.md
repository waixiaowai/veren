# DeepSeek Harness（dsh）核心概念解读

> 本文解读 dsh 中的八个核心概念：tool / skill / preset / plugin / agent / session / page / profile / workspace。
> 依据仓库文档（`docs/architecture.md`、`docs/glossary.md` 及各包 README）整理，成文于 2026-11-05。

## 一句话总结

**dsh（DeepSeek Harness）是一个全插件化的大模型 Agent 运行时：profile 把插件组合成应用，preset 把能力组合成 Agent，agent 调用 tool 与 skill 干活，session 把一切落成持久日志，workspace 和 page 负责让人看见。**

## 一段话介绍

dsh 构建在 Cordis 插件框架之上，产品里没有"核心"——模型适配器、工具注册表、会话日志、甚至 agent loop 本身都是插件，可从配置整体替换。启动时 `dsh --profile <name>` 选定一个 profile（如 `web`、`headless`、`sdk`），它按层堆叠 bundle 与 patch，最终展开成一棵插件树。运行期，每个 agent 拥有自己的 scope：全局注册的工具（tool，注册于 `ctx.tools` 的模型可调用能力）和技能（skill，按需加载的任务指令目录）可以被 preset（声明式的每-agent 能力组合）遮蔽或裁剪；agent-loop 驱动 agent 执行 turn 与 step，每次模型请求和工具调用都作为事件追加进 session 日志——"模型可见即可重建"是硬性不变量。在此之上，workspace 把会话按项目目录分组供 GUI 呈现，page 则指会话历史的分页读取或 Web 客户端的设置页面。整个系统的设计取向是：**能力可插拔（capability seam）、状态可重建（session log）、组合可配置（profile/preset）**。

## 详细介绍

### 0. 全景图

先给一张概念地图，后文按"组合层 → 运行层 → 持久层 → 查看层"的顺序展开：

```
┌─ 组合层（应用怎么拼出来）──────────────────────┐
│  profile ─堆叠→ bundle ─挂载→ plugin          │
│                    preset（单个 agent 的能力组合）│
├─ 运行层（干活的是谁、用什么干）──────────────────┤
│  agent ─调用→ tool / skill                     │
├─ 持久层（真相存在哪）───────────────────────────┤
│  session（append-only 事件日志）                │
├─ 查看层（人怎么看见）───────────────────────────┤
│  workspace（项目分组）  page（分页/页面）        │
└────────────────────────────────────────────────┘
```

一句话串起生命周期：`dsh --profile web` 启动 → 插件树就位 → 用户在某个 workspace 下开一个 session → session 里跑着 agent → agent 用 preset 选定的 tool/skill 工作 → 一切写入 session 日志 → 客户端通过流式与分页（page）呈现。

---

### 1. plugin（插件）—— 一切代码的载体

dsh 的底座是 Cordis：插件向共享 context 贡献**服务（Service）、类型化事件、可逆 effect**。关键在于"全插件化"——模型适配器、工具注册表、会话日志、agent loop 本身全部是插件，因此每一个都可以从配置替换，没有特权核心可打补丁。

三条硬规则刻画了插件的形态：

- **注册即 effect**：任何贡献（工具、prompt 段落、事件监听）都经 `ctx.effect()` / `ctx.on()`，注册句柄就是卸载器，插件卸载时一切自动回滚。
- **能力缝（capability seam）**：一个可替换能力 = Service Definition（拥有 `ctx.<key>` 的服务定义）+ Provider（实现者）+ Consumer（使用者，通常是模型工具）。以 shell 为例：`dsh-shell` 定义、`dsh-bash-local`/`dsh-bash-sandbox` 实现、`dsh-tool-bash` 消费。换一个 provider，Bash/PTY/LSP 整体迁移，无分叉。
- **新行为上扩展点，不改 loop**：加模型厂商就注册 `ctx.llm` adapter；加工具就注册 `ctx.tools`；加人类命令就注册 `ctx.commands`。

包命名统一为 `@deepseek-ai/dsh-<name>`，在 `packages/<group>/<pkg>` 工作区里开发。

### 2. profile 与 bundle —— 应用的组合方式

一个运行中的 dsh 就是一棵启动时组合出来的插件树，组合的最高单位是 **profile**：

- **profile** 是存在 Harness home 里的命名组合，内容包括：它堆叠哪些 bundle、持有的 out-of-tree 插件、用户自己的 `cordis.patch.yml`。出厂模板有五个：`web`（浏览器应用）、`headless`（一次性运行）、`sdk`（JSON-RPC 服务）、`sdk-minimal`（极简 SDK 树）、`acp`（自动化协议）。只有 `dsh --profile <name>` 这一条路能启动应用——包内 bin、demo、SDK 逃逸口都被禁止，这是仓库的门禁规则。
- **bundle** 是"Cordis 配置行 + 它们挂载的代码"的分发格式（如 `dsh-base` 是共享首层：模型适配、工具、持久化、沙箱与审批）。bundle 的意义在于：它插入的任何行仍可被上层 patch 修改，可组合性不因分发而丢失。

层的应用顺序：profile 的有序 bundles → profile 自己的 patch → home patch → 命令行 `--patch` 覆盖。patch 按 id 定位一行，整体替换其配置或插入新行。用 `dsh --profile web --dump-config` 可以看到本机实际启动的完整插件树，任何一行都可以被你自己的 patch 换掉。

### 3. agent —— 运行时执行者与 scope 机制

**agent** 是 `Agent` 接口的运行时实例（`ctx.agents` 活跃注册表 + `agent/*` 实时事件），默认驱动是 agent-loop。理解 agent 的关键是 **scope（作用域）**：

- 一切注册要么是**全局的**（所有 agent 可见），要么**属于某一个 scope**；两层结构，扁平，不沿子树继承。
- 约定：**活着的 agent 就是它自己 scope 的 key**；通过 `agent.ctx` 注册的内容既对该 agent 可见，又与该 agent 同生命周期。
- **shadowing**：同名时最近层 outright 胜出——scoped 工具/段落/变量在该 scope 内替换全局同名者。这是"每个 agent 一份人格/一套工具变体"的实现机制。
- **restriction**：`tools.restrict` 对全局工具集做交集过滤，被滤掉的工具在 prompt 和执行层都表现为不存在。

子代理（subagent）与 Agent Teams 也构建在同一接口上：子代理是独立 scope 的新 agent，父子关系只作为数据（lineage）携带，不影响可见性。

### 4. tool 与 skill —— 模型可见的两种能力

二者都是"模型看得见、用得上"的东西，但形态不同：

**tool（工具）**是模型可直接调用的函数式能力：

- 注册在 `ctx.tools`（scoped 注册表 + 守护执行管道），工具的 name/description/JSON-Schema 自动进入系统提示词组装。
- 执行走 `tools/pre-execute → tools/execute → tools/post-execute` 瀑布（监听者必须 `next()` 委托），调用与结果分别落为 `tool/call`、`tool/result` 会话事件。
- 大多数 tool 只是某个能力缝的消费者端：`dsh-tool-bash` 消费 shell 缝，`dsh-tool-web` 消费 web 缝。换 provider 不需要新工具。

**skill（技能）**是按需加载的任务级指令包（"怎么做某类事"的说明书，而非"能做某事"的函数）：

- `ctx.skills` 注册表合并多个 provider 的目录：本地文件系统（`dsh-skill-filesystem`）、插件内嵌（`ctx.skills.register`）、远程服务。列表只读摘要，正文按名字按需加载。
- 重名解析有确定规则：层内按 rank、注册序、provider 本地序；层间最近层胜出。
- 每个技能带调用策略 `modelInvocable` / `userInvocable`，分别控制模型工具面和人类命令面是否可见——一次发现结果可以同时服务两个面。
- 模型侧经 `dsh-tool-skill` 的 `skill` 工具使用：先看目录，再按名加载完整指令。

对比记忆：**tool 是"手"，skill 是"操作手册"**；tool 常驻 schema 占提示词，skill 只在目录里留一行摘要，加载才展开。

### 5. preset —— 单个 agent 的能力组合

**preset**（`packages/preset/`：`agent-preset` + `agent-preset-registry` + `persona`）回答的问题是："怎么给某一个 agent 一套不同的能力？"答案是不写代码，用普通 Cordis 配置声明：

- 一个 preset 声明该 agent 的工具集、prompt 段落、技能——本质是声明式的子插件组合，挂载时落到该 agent 的 scope 层，天然获得 shadowing 语义。
- `ctx.agentPresets` 注册表管理 preset 的选择与运行时修订（revision）：Host 共享同一个 agent loop，每个 agent 只看到自己所选修订的工具/prompt/技能。
- 典型场景：给某个 session 换一套精简工具；为子代理定义专门人格（`persona` 提供可组合的人格部件）。

preset 与 plugin 的关系可以概括为：**plugin 是全局挂载，preset 是按 agent 挂载**；前者改变整个应用，后者只改变一个 scope。

### 6. session —— 持久真相来源

**session** 是 append-only 的 `SessionEvent` 日志加内存 store（`ctx.sessions`）。它是整个系统最重要的不变量的载体：

> **模型可见 ⟺ 已落日志。** 每次发给模型的请求都必须能从日志重建；要新增一种模型可见输入，就必须新增会话事件。

围绕这个不变量的关键设计：

- **loop 层级**：step（一次模型请求 + 它引发的工具执行）→ turn（零或多个 step，从认领输入到不再欠账）→ round（外层策略迭代，如 goal round）。`turn/*`、`step/*`、各类 `message`、`tool/*` 都是 durable 事件。
- **派生而非复制**：fork、resume、transcript、导出、遥测全部从日志派生（`deriveMessages()` 把日志投影成模型历史）；实时 UI 的增量来自 `agent/assistant-stream`，但最终仍以日志里的紧凑流结算。
- **投影缝**：`ctx.sessionProjections` 注册的投影单元折叠已提交事件，供各领域读取快照——领域服务永远不直接翻原始日志。
- **版本化与迁移**：JSONL 日志按版本分 generation（`session.vN.jsonl[.zstd]`），已提交的 generation 永不重命名/覆写/删除；升级走"相邻迁移链"（每个迁移包只负责 `vN → vN+1` 一步），读取时组合整条链。
- **插件改消息内容**的方式是注册纯消息投影（projection），而不是改写已落的事件。

一句话：session 不是"聊天记录"，而是**系统唯一认可的事实账本**——进程可以死，UI 可以换，账本在，一切就能重建。

### 7. workspace —— 项目与 session 的分组

**workspace**（`ctx.workspaceRegistry`，`packages/workspace/workspace`）是 host 侧的持久项目列表，服务 GUI 的工作目录侧边栏：

- 每个项目对应一个规范化的真实目录（`realpath` 为唯一性标准，符号链接会归并）；session 按其运行目录自动归入项目，且只属于一个项目。
- 支持重命名、排序、置顶；**隐藏** session（从分组消失但历史完整保留，之后可恢复原位）；**归档**前会通过 `workspace/session-activity` 瀑布询问"还有什么在跑"（运行中的 turn、后台 job、子代理、提醒），可要求先停再归档。
- **移除项目永不删数据**：文件夹、文件、会话历史一概不动，其 session 变为未分组；重新添加同一目录会开一个全新空项目。
- 首次启动有 first-use workspace：无任何历史时自动创建默认工作区。
- 对模型完全不可见：不注册工具、不注入 prompt，零 token 成本。

它体现的分界是：**workspace 是人的组织维度，session 是机器的事实维度**，二者只通过"运行目录"这一点接触。

### 8. page —— 三处用法，按语境对号

"page" 在 dsh 里不是一等领域名词，出现在三个互不相干的位置：

1. **会话历史分页**（API/SDK，最正式的用法）：`session/page`（现已更名 `events`，旧入口保留为 deprecated）从持久日志读一页按时间排序的事件，返回记录、`hasMore` 和 inclusive cursor。分页按 **Turn 对齐**：客户端 `loadOlder()` 向上翻一页，`loadThrough(seq)` 循环翻页直到窗口覆盖目标 seq（跳转到某轮对话）。Web 客户端的日志窗口就是"follow 实时流 + page 补历史/修缺口"两件套。
2. **Web 客户端页面**（UI 层）：设置体系的扩展点以页面为单位——`settings.section` 注册设置分区页，`settings.plugins.tab` 注册插件页标签，Plugins page 承载官方配置页；另有加载期的 boot page（纯 DOM，保证插件激活失败时用户看到原因而非白屏）。
3. **浏览器页面**（工具层）：browser-use 工具参数中的 `pageId`，指被自动化控制的浏览器标签页。

看到这个词时先问一句"在哪个平面"：API 分页、UI 页面，还是浏览器页。

### 9. 把概念串起来：一次请求的完整旅程

以用户在 Web 里发一条消息为例：

1. **组合**：`dsh --profile web` 启动，profile 堆叠 `dsh-base` + `dsh-web-app` 等 bundle，展开为插件树；用户的 home patch 与 `--patch` 覆盖生效。
2. **建会话**：用户在某个 workspace 项目下新建 session；session 可能选了一个 preset，该 preset 的插件落到此 agent 的 scope 层，遮蔽/裁剪全局能力。
3. **开 turn**：agent-loop 认领输入，快照模型选择，组装 prompt 段落 + 该 scope 生效的工具 schema（preset 过滤后的集合）；skill 目录作为一条消息进入上下文。
4. **跑 step**：模型请求落为 `request/header`，模型调用 tool（如 `bash`，背后是 shell 缝的某个 provider），执行经三段瀑布管道，`tool/call`/`tool/result` 依次落日志；模型还可能用 `skill` 工具加载一份完整指令正文。
5. **结算**：工具欠新请求或新输入到达就开下一个 step；不再欠账则 turn 关闭。助手消息内嵌产生它的完整紧凑流。
6. **呈现**：Web 客户端从 `follow` 实时流渲染增量，翻旧历史时用 `page` 补页；workspace 侧边栏里这个 session 始终归属它的项目目录。
7. **重生**：进程重启后，一切 UI 状态从 session 日志与投影重建——fork、resume、导出同理，因为账本从未丢过事实。

### 10. 设计哲学小结

八个概念背后是四条贯穿始终的原则：

| 原则 | 体现 |
|---|---|
| 一切可替换 | 全插件化 + capability seam：换 provider 不改消费者 |
| 一切可重建 | session 日志是唯一真相；模型可见即可重建 |
| 组合优于代码 | profile/bundle 定应用，preset 定 agent，全部是配置 |
| 人机分面 | workspace/page 供人查看；tool/skill 供模型使用，互不越界 |

理解了"组合层拼出运行层、运行层写入持久层、查看层读取持久层"这条主线，任何一个新包、新扩展点都能在地图上找到位置。

---

## 延伸阅读（仓库内出处）

- [docs/architecture.md](docs/architecture.md) — 架构总览：profile/bundle、事件三域、turn 流程
- [docs/glossary.md](docs/glossary.md) — 领域词汇表：capability seam、scope/lineage、turn/step/round
- [docs/cordis-primer.md](docs/cordis-primer.md) — Cordis 框架入门（插件、服务、瀑布事件）
- [packages/preset/README.md](packages/preset/README.md) — agent preset 组
- [packages/skill/skill/README.md](packages/skill/skill/README.md) — skill 注册表
- [packages/workspace/workspace/README.md](packages/workspace/workspace/README.md) — workspace 注册表
- [packages/api/session-controller/README.md](packages/api/session-controller/README.md) — `events`/`page` 会话历史分页
- [packages/client/ui-settings/README.md](packages/client/ui-settings/README.md) — 设置页面扩展点
