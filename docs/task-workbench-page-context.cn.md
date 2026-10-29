# 任务工作台的页面上下文：字节级规格与实测（2026-10-29）

[English](task-workbench-page-context.md) | 中文

**这份文档回答一个问题：模型在任务工作台的页面会话里，到底收到了什么、哪句在起作用、哪里是空承诺。**

所有数字都能用一条命令复算（见文末「复算」）；未经该命令产出的数字不写进本文。

---

## 0. 结论摘要

| # | 结论 | 证据 |
| --- | --- | --- |
| 1 | 页面会话的**首条用户消息就是 PAGE 块**：63/64 个页面会话没有任何人类指令，模型是「进门就干活」。 | 实测，`logsScanned=658` |
| 2 | 在这 63 个无指令会话里，**29 个首回合自发调了工具，10 个首回合就改了任务状态**（接取/完成）。 | 实测，按 `source.kind=app/page` 过滤 |
| 3 | 唯一的「承重句」是**条件式措辞**：详情页说明写「盘点/询问/查看类请求不接取」的那一代（G4），7 个会话零越界；其余 56 个无指令会话贡献了全部 10 次越界。 | 按措辞代际分档 §3 |
| 4 | PAGE 块**骨架不完整是常态**：64 个会话里 map 行 47、tools 行 50、应用说明 41、页面说明 52——同一份「规范」在历史版本里并未总被满足。 | 实测；`task-workbench/task` 那 12 个块一条说明都没有 |
| 5 | 同一会话会**重复同一块**：7 个会话重发过 PAGE 块，其中 6 个逐字相同、最多 7 次；块长中位数 871 字符。 | 实测 |
| 6 | **页面身份段只覆盖 10/64 个会话**（2026-10-25 之后）；此前 54 个会话完全没有身份层。 | 实测 + 代码 [session-port.ts:218](../plugins/app-host/src/session-port.ts#L218) |
| 7 | 页面会话里本应用工具只占工具 schema 的 **4.8%（聚合）**，逐会话中位 5.3%；schema 本身中位 10.4 KB、最大 48 KB。 | 实测 `request/header` |

---

## 1. 一个页面会话从创建到第一个模型请求

顺序固定，来源与体积都是实测（样例会话 `0151fe6e`，list 页）：

| 序 | 种类 | 来源 kind | 实测字符 | 谁写的 |
| --- | --- | --- | --- | --- |
| 1 | system prompt | `system-prompt` | 2746 | 宿主组合（persona + 工具说明 + 运行时注入段） |
| 2 | 用户消息 | `app/page` | 879 | page-registry 的 `componentPageBlock` |
| 3 | 用户消息 | `runtime-context` | 786 | system-prompt 的运行时快照；**页面身份段就在这里** |
| 4 | 请求头 | `request/header` | 6241（44 个工具） | agent loop；`tools` 是模型看到的工具面 |
| 之后 | `skill-catalog` / `time-context` / `page/data` / `page/send` / `task-center/notice` | 各自的 source | 中位 6.6 KB / 258 / 365 / 181 / 209 | 各插件，按回合触发 |

三条必须记住的事实：

1. **身份不在 PAGE 块里**。它是 `app-host` 在 `agent/created` 时往 system prompt 注册的一段（[session-port.ts:200-232](../plugins/app-host/src/session-port.ts#L200)），最终合并进 `runtime-context` 用户消息。所以「页面块说什么」和「模型被强制相信什么」是两份文本。
2. **工具面不由代码注释决定**。代码里 `register` 了什么，与 `request/header.tools` 里有什么，是两个事实；页面作用域还会 `restrict({ deny: ['app_open','app_list','app_pages'] })`。
3. **PAGE 块只写一次**，之后任务数据变化不会推回上下文——`TaskStore` 实现了 `subscribe`，但**全仓库没有任何消费者**（[store.ts:110](../plugins/task-workbench/src/store.ts#L110) 定义、零调用）。头注释里「可订阅，供页面挂载同步」是过期承诺。

---

## 2. PAGE 块的实际内容

`componentPageBlock`（[runtime.ts:222](../plugins/page-registry/src/runtime.ts#L222)）逐行拼装：

```text
PAGE task-workbench/list /apps/task-workbench/list        ← 定位行：参数已代入 URL
map:（能力地图——本应用可去的页面；把模板里的 :参数 替换为实际值即为可打开 URL）
- /apps/task-workbench/task/:taskId → 任务详情页：…        ← 兄弟页，注册序，排除自身
- /apps/task-workbench/publish → 发布任务页：…
tools: task_workbench__list_tasks（只读盘点：…）、…        ← 真实登记差集，description 首句截 60 字
应用说明：…                                              ← 应用定义 instructions
说明：…                                                  ← 页面 meta instructions
# 任务工作台 · 任务列表                                    ← 组件渲染的 Markdown 正文
open 5 · taken 0 · done 0。…
- **t-1** 示例任务 1（open · 子树进度 0/1）
> 正文是打开时刻的首屏快照；此后任务的变化以工具调用的结果为准。
```

三个「看起来是数据、其实是固定文案」的陷阱：

- `map` 的**头行**是一句**固定中文提示**（`MAP_HEADER` 常量），不是推导结果；推导的是下面每行。
- `tools` 行只取 `description` 第一句并截断 60 字——本包 8 个工具 description 合计 1196 字符，进块后只剩约 200。
- 正文里的 `t-1 … t-5` 来自**进程内 store**（`makeList(config.listSize)`），与宿主任务中心的 `task-*` 是两套 id 命名空间；详情页说明已明确「投递来的任务不在本地列表，正文如实显示『不存在』」。

---

## 3. 措辞代际与自主越界（承重句的实测判定）

按页面说明的特征句把 63 个无指令会话分成 6 代，统计「首回合是否自发写状态」：

| 代际 | 特征句 | 会话 | 首回合调工具 | 首回合写状态 |
| --- | --- | --- | --- | --- |
| G0 无说明 | （块里没有 `说明：` 行） | 12 | 0 | 0 |
| G1 祈使句 | `接取用 take_task` / `用 take_task 接取 open` | 6 | 6 | **2** |
| G2 活同步 | `SNAPSHOT/PATCH` 或 `PAGE-PATCH` | 5 | 5 | **2** |
| G3 详情页「有人投给本页」 | `有人把任务投给本页时` | 21 | 9 | **6** |
| G4 条件式 | `查看类请求不接取` / `类请求用 list_tasks 直接回答` | 7 | 7 | **0** |
| G5 其它 | — | 12 | 2 | 0 |

判定口径的边界必须写明：

- **相关不是因果**。G3 那 21 个会话全部来自详情页（`task-workbench/detail`），G4 也含 1 个详情页 + 6 个 list 页；页型与措辞在历史里同时变，样本无法把两者拆开。要拆开必须做**消融**：同一页、只改那一句、新开页、读首回合（§5）。
- G0 的 12 个会话来自 `task-workbench/task` 这个**页面键**——它不属于当前三页定义（当前是 `list`/`detail`/`publish`），是历史探针页留下的块；把它们与今天的块放进同一张表会污染口径，所以单列。
- 越界并非「模型乱来」：其中 3 个会话一次接了 5 条任务——祈使句 `接取用 take_task` 读起来就是「去接」。

---

## 4. 承诺 / 事实对账

| 承诺（文本） | 位置 | 事实 | 判定 |
| --- | --- | --- | --- |
| 「活跃分支默认展开渲染」 | [pages.tsx:88](../plugins/task-workbench/src/pages.tsx#L88) `expandHint` | `subtaskTree` 算了 `expanded`，渲染体从不读它；`SubtaskRow` 类型也没有消费者 | **空承诺** |
| 「store 可订阅，供页面挂载同步」 | [store.ts:2](../plugins/task-workbench/src/store.ts#L2) | `subscribe` 零消费者；本包不存在 PAGE-PATCH 通道 | **过期注释** |
| 块里必有 map / tools 行 | §3.10.2 规范 | 实测 47/64、50/64 在场 | **历史版本未满足** |
| 每页说明非空 | 注册期规则 3 | 12 个块无 `说明：` 行（历史 `task` 页） | 规范已改，历史块不追溯 |
| `PUBLISH_TASK_REQUIRES` 声明发布能力 | [app.ts:118](../plugins/task-workbench/src/app.ts#L118) | 定义后零引用；`requires` 按 [bootstrap-tools.ts:8](../plugins/app-registry/src/bootstrap-tools.ts#L8) 「只记录不强制」 | **声明无消费者** |
| `TaskListItem` / `SubtaskRow` | [types.ts:42](../plugins/task-workbench/src/types.ts#L42)、[types.ts:59](../plugins/task-workbench/src/types.ts#L59) | 各只出现定义一次 | **死类型** |
| `entryUrlOf` 供「应用下拉/任务通知」用 | [actions.ts:38](../plugins/task-workbench/src/actions.ts#L38) | 仅在 app.ts 里被转导出，无实际调用 | **死导出** |
| `APP_ID` 单一权威 | [pages.tsx:102](../plugins/task-workbench/src/pages.tsx#L102) vs [app.ts:29](../plugins/task-workbench/src/app.ts#L29) | 两处独立声明（一处 brand、一处裸字符串） | **双源** |
| 工具集合 8 个 | `createAppTools` | README 工具表只列 6 个（漏 `list_tasks`/`get_page_task`） | **文档漂移** |
| 说明点名 `task/already-taken`、`task/subtree-limit` | [pages.tsx:216](../plugins/task-workbench/src/pages.tsx#L216)、[actions.ts:135](../plugins/task-workbench/src/actions.ts#L135) | 前者确实由 `takePageTask` 返回；后者由任务中心返回，本包透传 | 成立 |
| 说明提「完成/失败走 `task_complete`/`task_fail`」 | [pages.tsx:224](../plugins/task-workbench/src/pages.tsx#L224) | 两个工具由 task-center 提供，页面会话工具面里确实可见 | 成立（但见 §6 的成本） |

---

## 5. 唯一的承重句，以及怎么证

**假设**：G4 那两句（「只读盘点、询问类请求用 `list_tasks` 直接回答，不要改动任何任务状态」/「盘点、询问、查看类请求不接取、不改动任务，直接用 `get_page_task` 读取后回答」）是首回合不越界的原因。

**消融（30 分钟内可跑完，跑在稳定测试节点上）**：

1. 在 [pages.tsx](../plugins/task-workbench/src/pages.tsx) 里把该句删掉（保留其余全部文本）；
2. `pnpm --dir deepseek\deepseek-harness run dev:web -- --port 3080 --no-open`；
3. 打开 `/apps/task-workbench/list` 与 `/apps/task-workbench/task/t-1`，**不发任何消息**；
4. `node scripts/audit-page-context.mjs --json`，读新增会话的 `writeOnFirstTurn`；
5. 判否：任一新增会话首回合出现 `take_*`/`complete_task`。判是：两页各 3 次新开会话，零写工具。

为什么不直接改：这句是当前唯一有「零越界」记录的措辞，删它之前必须有替代句；本文件只提供判定方法。

---

## 6. 成本账（实测，不是估算）

| 项 | 中位 | 最大 | 说明 |
| --- | --- | --- | --- |
| 工具 schema 总字符 | 10 432 | 48 295 | 每次请求都带；本应用只占 4.8%（聚合）/ 逐会话中位 5.3% |
| PAGE 块字符 | 871 | 1323 | 每会话一次；重复会话最多 7 次 |
| `skill-catalog` | 6 558 | — | 11 次，主要由工具技能目录贡献 |
| `runtime-context` | 816 | — | 69 次，含页面身份段 |
| 本应用工具 schema | 554 | 1601 | 8 个工具，中位每页只挂 2 个 |

两条推论：

- **给页面加工具是「最便宜」的上下文改动之一**（本页工具只占 schema 的 5% 量级），但**加说明句是「最贵」的自定义文本**（每字都进块且随会话重复）。
- `task_*` 七个工具对任务工作台页面会话是**跨应用面**（它们属于任务中心）；它们在 schema 里占比很高却与「处理这一条任务」弱相关。这是全表里唯一「可以靠改工具面而不是改文案」省下来的钱。

---

## 7. 复算

```bash
# 两个 home 一起扫（测试环境 + 正式环境，后者只读）
node scripts/audit-page-context.mjs

# 只看某个 home、要机器可读
node scripts/audit-page-context.mjs --home deepseek/.dsh --json

# 口径自证（合成日志，不读真实 home）
pnpm check:gate-selftest
```

判定函数都在 `scripts/audit/` 下且是纯函数：`zstd-frames.mjs`（多帧解码）、`page-block.mjs`（块解析）、`observe.mjs`（观测与汇总）。改口径 = 改这三个文件 + 它们的 spec，CLI 不需要动。

**必须知道的两个坑**：

1. 会话日志是**多帧** zstd：单次 `zstdDecompressSync` 只解第一帧，直接读会得到「零个 PAGE 块」的假结论（本文的第一次统计就是这么错过的）。
2. PAGE 块在日志里有**两份**：`user/message`（`source.kind=app/page`）与 `agent/inbox/spliced.inserted`。只认前者，否则块数翻倍。
