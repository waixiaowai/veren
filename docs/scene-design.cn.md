# 场景（Scene）：DSH 的情境轴

[English](scene-design.md) | 中文

> **本文已升级为分章方案**：更易读、按章导航的版本在 [`docs/scene/`](./scene/)（封面入口 `docs/scene/index.md`，含架构图、逐模块设计、验收与追溯）。本文件保留为单文件技术底稿（v2，2026-11-05），内容与方案一致，二者取一阅读即可；后续更新以 `docs/scene/` 为准。
>
> **This file has been superseded by the chaptered set** at [`docs/scene/`](./scene/). It remains as the single-file technical record (v2, 2026-11-05); future updates happen in `docs/scene/`.

## 摘要

**一句话：场景（scene）是 DSH 的一等概念——同一个人（preset），走进不同场合，自动换装该场合所需的工具、技能与记忆切片。**

场景 scene 采用"人—场合"模型：preset 定义你是谁（人格与记忆库的主体），scene 定义你在哪、正在做什么——办公室上班、回家陪孩子、车上开车、咖啡厅聊天、散步、敲代码、阅读。人不变，场合变，能力面整体换装：挂载的工具集、激活的技能集、可召回的记忆切片随 scene 一起切换，就像同一个演员在不同场次带不同的道具与台词。因此 scene 不是 tool、skill、preset 中任何一个的别名，而是站在它们之上的**组合键与开关**——plugin 负责交付场景，session 则是"某人 × 某场景 × 一段时间"的经历实例。场景既支持显式进出，也支持按上下文自动判定进入哪个场景，如同相机的自动场景识别。

## 1 问题：挂载逻辑在重复造轮子

今天工具与技能的挂载是静态、局部的。任务工作台（task-workbench）已经实践过"不同页面挂不同工具"（list 页只见接任务工具，detail 页只见处理任务工具），但这套互斥挂载逻辑是页面插件各自手写的。更普遍的"换场合换能力"需求——翻译、写周报、敲代码、陪孩子——每个插件都要重造一遍挂载/摘除代码；而记忆召回完全不分场合：上班时召回带娃笔记，陪孩子时召回代码片段。

缺的是把"什么时候、挂什么、记什么"收拢成一个声明式契约的一等概念。

## 2 概念定义与层次

```
plugin   交付单元    谁提供的
preset   身份轴      你是谁：人格、模型、记忆库主体
scene    情境轴      你在哪：挂哪些 tool/skill、召回哪片记忆   ← 本提案
session  经历实例    某人 × 某场景 × 一段时间
tool     能力原子    agent 可调用的动作
skill    知识原子    agent 按需加载的程序性知识
```

scene 是 tool / skill / memory 的组合键与开关，站在原子概念之上，不替代任何一个。同一 preset 切换 scene，三个面（工具、技能、记忆召回）整体换装。

**一句话定位（v2 修订）**：scene = **运行中可切换的 preset 片段**。preset 在会话创建时解析且运行中 agent 保留既有组合（已核实，见 §5），scene 补的正是"同一个活会话内的运行时切换"这个空位；实现上不发明新挂载机制，直接复用 scope/shadowing、`tools.restrict` 与 `system-prompt/assemble`。

## 3 类比模型

**演员与场次**：同一个演员（preset），第一幕在办公室、第二幕在家里，每场只带自己的道具（tools）和台词（skills），只记得这场戏该记得的往事（memory 切片）。

**相机场景模式**：同一台相机，人像/夜景/运动模式切换处理参数，且相机界早有"自动场景识别（automatic scene detection）"——自动切换这个行为连名字都是现成的。

## 4 命名裁定

- **语义**：候选例子全是"场合态"而非叙事弧。scenario 指 what-if 故事线（测试场景、用户旅程），scene 指人所处的情境——"场景"的主译就是 scene。
- **先例**：戏剧场次、相机场景模式，双重印证。
- **域内无碰撞**：DSH 词汇表（tool/skill/preset/plugin/agent/session/page/profile/workspace）没有任何 scene 占位。
- **刻意避开**：`context`（cordis Context 已占）、`profile`（DSH profile 已占）、`mode`（互斥全局开关语义，表达不了记忆切片）、`focus`（桌面端语境 = 焦点）。
- **域外碰撞**：three.js 的 Scene 属图形域，对 agent 框架误读风险低，接受。

## 5 交叉验证：与既有机制的关系（全部已核实）

| 既有机制 | 已核实的现状（出处） | scene 的复用方式 |
|---|---|---|
| preset | `packages/preset/agent-preset-registry/README.md`：preset 是普通插件行（声明式子插件组合），会话创建时解析，**"existing Agents retain the composition they already use"**；`selectedDefault` 修订只影响**新**会话 | scene 定义沿用同一声明格式（子插件行）；scene 补位"运行中切换"，不与 preset 重叠 |
| scope / shadowing | `docs/dsh-concepts.md` §3：活着的 agent 就是自己 scope 的 key；`agent.ctx` 注册与 agent 同生命周期；同名最近层 outright 胜出 | **进入场景 = 往 agent scope 挂一层组合；离开 = 卸掉该层**。卸载回滚由 cordis effect 语义免费提供，不需要自造挂载句柄 |
| `tools.restrict` | `packages/core/tools/src`：restriction 注册时编译、重复做 live-global 查找、可见定义 = restriction + shadowing 之后的结果；scoped restriction 变化有事件 | 场景内工具收窄直接用 restrict（交集过滤，模型与执行层都表现为不存在）；场景专属工具走 scope 层注册（如 task-workbench 现状） |
| `system-prompt/assemble` | `packages/core/system-prompt/src`：per-step 协作瀑布，tools / contexts / variables 按 scope 参与 | 场景 prompt 段落随 scope 层生灭，每步组装自然反映当前场景 |
| skill 注册表 | `docs/dsh-concepts.md` §4：分层合并、最近层胜出；目录只留一行摘要、正文按需加载 | 场景技能 = scope 层注册目录；正文不常驻，无额外上下文成本 |
| session 不变量 | `docs/dsh-concepts.md` §6：**模型可见 ⟺ 已落日志**；改消息靠注册投影，不改写已落事件 | 场景切换凡模型可见处必须落日志（见 §7）；记忆切片"读时过滤"走投影或 prompt 段落，不重写日志 |
| compaction | `docs/subsystems/compaction.md`：trigger = `pressure` / `context-overflow`；自动策略跑在 `agent/pre-step` 与 `agent/request`；`compactNow` 在 turn 间做维护；surface 替换 = 一条 `user/message` + `surfaceOp replace`，bookkeeping 走 log-only 事件、`SurfaceEventType` 刻意不扩展 | 场景切换**同位执行**（turn 边界）；事件形态学 compaction（log-only 记账 + 消息载体承载模型可见面）；**搭 compaction 便车**（见 §8） |
| llm 线协议 | `packages/llm/llm/src/types.ts`：`SystemPromptUpdate('in-history')`、`ToolUpdate('in-history' / 'addition-only')`、`deferLoading`、`LlmModelContext.contextWindow`、`cacheReadTokens/cacheWriteTokens` | 缓存友好的中途换装**线协议已存在**，场景直接映射（见 §8），不发明新的缓存机制 |
| tokenMeter | compaction 文档：`ctx.tokenMeter` 直接拥有估算与重放 | 场景面成本（声明面 token、切换的缓存失效）用它记账 |
| projection | `docs/dsh-concepts.md` §6：`ctx.sessionProjections` 投影单元折叠已提交事件，领域读快照 | 记忆召回的"读时过滤"与跨场景派生视图走投影缝 |

**v2 修正记录**（相对初稿的两处实质修正）：
1. 初稿让 `scene/entered`/`scene/left` 做纯运行时 `emit`——**违反 session 不变量**（模型可见 ⟺ 已落日志）。凡改变模型可见面，必须落会话日志。
2. 初稿自造 `MountHandle` 挂载凭证——**重复造轮子**。scope 层 + `tools.restrict` + effect 卸载语义已覆盖全部需求。

## 6 数据模型（草案 v2）

```ts
// src/types.ts 只放类型。跨边界 id 用 brand，零运行时开销
// types only in src/types.ts. Cross-boundary ids use brand, zero runtime cost
export type SceneId = Branded<'sceneId'>

export interface SceneDefinition {
  id: SceneId
  label: LocaleString            // 中英双语显示名 / bilingual display name
  enter: SceneEnterCondition     // 显式进入 / 自动判定条件 / explicit or auto-resolved entry
  composition: PluginRow[]       // 声明式子插件行，学 preset 格式 / declarative rows, preset-style
  restrictTools?: ToolRef[]      // 全局工具面收窄为该集合 / narrow global tools to this set
  memory?: MemoryScope           // 记忆召回切片 / memory recall scope
  page?: PageRef                 // 常见载体：场景绑定到某页面 / scene bound to a page
  coexistWith?: SceneId[]        // 默认互斥；显式声明可并存 / mutually exclusive unless declared
}

export interface SceneState {
  sceneId: SceneId
  sessionId: SessionId
  enteredAt: number
  scope: Scope                   // 场景层本体；离开 = dispose 该 scope / the layer itself; leave = dispose it
}
```

工具面二分：**收窄**（restrict 全局集）与**新增**（scope 层注册场景专属工具，如 `take_task`）各走各的既有机制；`SceneState.scope` 就是全部摘除凭证。

## 7 运行时行为（设计意图 v2）

生命周期：`resolve → enter →（switch）→ leave`，**切换只发生在 turn 边界**（与 `compactNow` 同位的 agent 维护点，不在 turn 中途）。

- **显式进出**：API 调用 enter/leave，请求排队到下一个 turn 边界生效。
- **自动判定**：`scene/resolve` 走 **bail**——各监听器依据上下文（页面 URL、时间、会话内容）提出判定，第一个决定性结果生效即短路；无人拍板则维持现状。
- **进出的账本形态（学 compaction）**：bookkeeping（谁判定、何时、receipts）走 **log-only** 会话事件（declaration merging 新增 `scene/entered`、`scene/left`，不进 `SurfaceEventType`）；模型可见面（工具加减、场景提示词）由消息载体承载——支持 `ToolUpdate` 的模型走 `tool-addition`/`tool-removal` 块，场景提示词走最新 system 消息。**每步 request header 快照 sceneId**（与快照模型选择同法），保证"模型可见即可重建"。
- **互斥**：同一 session 同一时刻默认只在一个 scene；`coexistWith` 白名单是显式例外（开车 + 聊天是真实需求）。
- **恢复**：resume 时按 header 快照链回放重建当前场景，跨重启一致。
- **清理铁律**：离开 = dispose 场景 scope，cordis effect 逆序回滚；registry 贡献带 dispose/HMR 安全测试。

## 8 缓存命中、上下文预算与压缩时机

### 8.1 缓存命中：切换的线协议已存在，场景按模型能力分级降级

请求前缀 = 系统提示词（含工具声明面）+ 历史。场景切换只要动了这两者之一，provider 前缀缓存就失效。llm 契约已定义三个档位的模型能力，场景照档位降级：

| 模型能力（llm 契约字段） | 场景切换的缓存代价 | 场景做法 |
|---|---|---|
| `systemPromptUpdate: 'in-history'` + `toolUpdate: 'in-history'` | 近似零：加减声明与提示词都**追加在缓存历史之后**，message 0 不重写 | 首选路径；`deferLoading` 工具经 `tool-addition` 块激活、`tool-removal` 块摘除，场景提示词作为最新 system 消息追加 |
| `toolUpdate: 'addition-only'`（无 removal） | 加工具近零；摘工具只能保留声明 | 离开场景时不摘声明，改"标记不可用"（执行层拒绝），模型面以提示词说明 |
| 两档皆缺（每请求全量声明） | 每次切换 = 全量前缀缓存失效 | 接受但要**记账**：`cacheReadTokens/cacheWriteTokens` 已在 token accounting 里，场景切换前后的账差就是切换成本；自动判定策略对这类模型提高切换门槛 |

### 8.2 上下文长度：scene 是预算机制，不是预算负担

- **收窄即省**：restrict 掉的工具不再占声明面与目录摘要，请求变小 → `pressure` 压缩被推迟。场景让长会话"按场合瘦身"，这与 compaction 的目标同向而非竞争。
- **场景声明面要目录化**：场景定义里进 prompt 的部分（场景说明、技能目录）学 skill 目录——只留一行摘要，正文按需加载。禁止场景自带大段常驻提示词。
- **反抖动（hysteresis）必须有**：每次切换都在历史里留下痕迹（tool-addition/removal 块、system 消息），往返切换让历史线性变胖。自动判定需要切换迟滞：新场景判定需连续 N 次 resolve 一致（或持续 M 轮对话）才生效，显式切换不受限。

### 8.3 压缩时机：搭 compaction 的便车

- compaction 的 trigger 是 `pressure` / `context-overflow`，自动策略跑在 `agent/pre-step`；surface 替换后**前缀缓存本来就要冷**——这正是切换场景的零成本窗口。策略：若压缩与场景切换同回合排队，切换并单压缩后一起生效，缓存只冷一次。
- 场景状态跨 compaction 存活：compaction 只折叠 surface span，场景的 log-only 事件与 header 快照不在其列；摘要消息可按 `MemoryScope` 打上 sceneId 标签（"写时打标"的第一次落地）。
- 场景切换**不触发**压缩：切换只是换面，token 欠账评估仍由 compaction 独占（职责不越界）。

## 9 事件与 API 面（草案 v2）

```ts
export const SceneToken = defineToken<SceneService>(`sceneService`)

// 会话事件经 declaration merging 挂进 SessionEventMap，log-only（学 compaction）
// session events join SessionEventMap via declaration merging, log-only (compaction precedent)
// scene/entered { sceneId, receipts }  – 谁判定、何时进、scope 层凭证
// scene/left    { sceneId, reason }    – 离开缘由：explicit | resolve | dispose

// 运行时判定走 bail（第一个决定性结果生效即短路）
ctx.on('scene/resolve', ...)    // @mode bail  自动判定该进哪个场景 / resolve the scene to enter

class SceneService extends Service {
  current(sessionId: SessionId): SceneState | undefined
  enter(sessionId: SessionId, sceneId: SceneId): Promise<SceneState>   // 排队至 turn 边界
  leave(sessionId: SessionId): Promise<void>
  register(def: SceneDefinition): Disposable   // 注册即返凭证 / registration receipt
}
// 经 declaration merging 暴露 / exposed via declaration merging: ctx.scenes / ctx.scene
```

错误结构化：`SCENE_CONFLICT`（互斥冲突）、`SCENE_NOT_FOUND`、`SCENE_PENDING`（切换已排队）等，稳定 code + 机器可读字段，misconfiguration fails loud。

## 10 边界与决策点

1. **可并存吗**：默认互斥，`coexistWith` 显式开放（开车 + 聊天是真实需求）。
2. **判定优先级**：显式 enter > resolve 判定；resolve 无结果 = 维持现状。
3. **记忆切片**：写时打标（该场合产生的记忆带 sceneId；compaction 摘要是第一处落地）、读时过滤（召回按当前 scene 过滤，走投影或 prompt 段落）——一次写入，两侧受益。
4. **反对双轨**：收编任务工作台等手写挂载逻辑，旧路径直接删除替换，不做兼容层。
5. **无 ToolUpdate 模型上的自动切换**：默认提高门槛（更迟滞），是否完全禁用交给配置。

## 11 演进路线

- **M1** 显式 enter/leave：scope 层挂载 + restrict 工具面 + 会话事件落账 + header 快照 sceneId
- **M2** `scene/resolve` bail 自动判定 + turn 边界切换 + resume 重挂
- **M3** 缓存分级降级（SystemPromptUpdate/ToolUpdate 映射）+ tokenMeter 切换记账 + 反抖动
- **M4** 记忆切片（写时打标、读时过滤走投影）
- **M5** 收编现存手写挂载实现（任务工作台等）

## 12 术语表

| 中文 | 英文 |
|---|---|
| 场景 | scene |
| 预设（人） | preset |
| 进入 / 离开场景 | enter / leave scene |
| 场景判定 | scene resolve |
| 记忆切片 | memory scope |
| 并存 | coexist |
| 切换迟滞 | switch hysteresis |
