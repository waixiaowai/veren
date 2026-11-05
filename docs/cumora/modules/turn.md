---
title: 回合（Turn）
description: "把一次唤醒推进为一次可回放、可预算、可失败的思考与行动，并保证副作用只发生在工具调用上。"
sidebar:
  order: 3
  label: 3 回合
draft: false
lastUpdated: 2026-11-04
---

## 3. Turn

回合模块负责"一次思考从开始到结束"：装载收件箱与上下文、驱动多跳工具循环、结算用量、写下可回放的事件与终态。它是智能体唯一能改变世界的地方，也是唯一需要为"花了多少钱、做了什么事、为什么停下来"负责的地方。

### 3.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 一次运行的创建、阶段推进、终态与事件时间线 | 谁该被唤醒、谁该让位（`Coordination`） |
| 上下文装载（收件箱、房间、记忆、技能索引、团队名册） | 人格与记忆的内容本身（`Agent`） |
| 多跳工具循环、工具结果裁剪、中途注入的处理 | 工具真正执行的宿主环境（`Host`） |
| 上下文水位、压缩与预算终止 | 模型价格与配额（`Billing`） |
| 用量采集、成本估算、失败分类与提示 | 消息与卡片的持久化（`Conversation`、`Board`） |
| 回合级幂等（指纹、单回合发言上限、让位令牌） | 跨回合的长期记忆整理（`Agent`） |

### 3.2 Capabilities

一次回合由四段构成：**装载**（收件箱、上下文、记忆、技能、名册）、**判断**（哪些内容值得回应，失败方向由是否有人在等决定）、**思考**（多跳模型调用与工具执行）、**收敛**（终止状态、用量结算、事件落库）。

业务规则：

- **一次唤醒一次回合**。同一智能体同一时刻只有一个回合在跑；期间到达的唤醒合并为"待重跑"，不排队成多条。
- **模型只有两个工具**：执行命令的 `bash` 与声明回合状态的 `set_turn_status`。所有世界动作（发言、建卡、写记忆、读文档）都通过命令行工具完成，模型不能直接改库。
- **没有流式回复**。回复是工具调用的一次性写入；流式增量只用于把思考过程展示给界面，不构成消息。
- **预算是硬边界**：跳数上限、上下文水位、单跳输出上限、单回合注入上限。触边即终止，并写明是哪一种边界。
- **状态必须显式声明**。模型连续两次在未声明终态的情况下停止调用工具，视为协议违规，回合记为失败。
- **完成后可被复核**。当回合声明完成但没有通过工具产生可见回复、却产生了副作用时，由一次廉价复核判断"声明是否成立"，不成立则打回继续。
- **中途注入不丢**。新消息可以在工具批次之间注入；超出单回合预算的注入延后到下一次唤醒，而不是静默丢弃。

### 3.3 Contracts

```ts
type RunStatus = 'running' | 'completed' | 'failed' | 'skipped'
type TurnStatus = 'done' | 'continue' | 'needs_clarification' | 'blocked' | 'waiting'
type LoopExit = 'max_hops' | 'budget' | 'turn_status' | 'protocol_violation'
type WakeReason = 'message.new' | 'idle' | 'manual' | 'background_scan' | 'poll.updated'

interface TurnBudget {
  maxHops: number                 // 默认 200
  softContextRatio: number        // 默认 0.75，超过触发压缩
  hardContextRatio: number        // 默认 0.95，超过终止
  maxOutputTokensPerHop: number   // 默认 4000
  maxToolOutputBytes: number      // 默认 8000，超出按信封截断
}

interface ToolInvocation {
  runId: string
  agentId: string
  name: 'bash' | 'set_turn_status'
  argumentsJson: string
  signal: AbortSignal
}

interface ToolOutcome {
  ok: boolean
  output: string
  sideEffects: SideEffect[]       // 发言、建卡、写记忆等已发生的事实
  exitCode: 0 | 1 | 2             // 2 = 被协调闸门拒绝（既非成功也非错误）
}

interface TurnRun {
  id: string
  agentId: string
  companyId: string
  reason: WakeReason
  status: RunStatus
  stage: string
  fingerprint: string             // 同一批输入的幂等指纹
  loopExit: LoopExit | null
  usage: { input: number; cachedInput: number; cacheWrite: number; output: number; reasoning: number }
  costUsd: number
  costEstimated: boolean
  startedAt: string
  finishedAt: string | null
}

interface TurnEvent { runId: string; kind: string; level: 'debug' | 'info' | 'warn' | 'error'; title: string; data: unknown }

abstract class TurnRunner {
  abstract run(agentId: string, reason: WakeReason, budget: TurnBudget): Promise<TurnRun>
  abstract invokeTool(call: ToolInvocation): Promise<ToolOutcome>
  abstract finish(runId: string, status: RunStatus, loopExit: LoopExit | null): Promise<void>
}
```

错误约定：模型侧限流返回 `RATE_LIMITED`（回合记 `skipped` 并写一次性提示，不当作失败）；额度耗尽返回 `MODEL_QUOTA_EXHAUSTED`（同样 `skipped`）；协议违规返回 `TURN_PROTOCOL_VIOLATION`；触达边界返回 `TURN_BUDGET_EXHAUSTED`。工具被协调闸门拒绝时**不返回错误**，而是返回 `exitCode: 2` 与可行动的新事实，由模型自行决定下一步。

### 3.4 Key Decisions

**决策一：模型只能通过工具行动。** 任何"看起来完成了"的声明都必须对应一次真实副作用；没有副作用的完成声明要经过复核。违反后果：智能体声称已建卡、已发邮件，实际什么都没发生，团队据此做出错误决定。

**决策二：预算先于礼貌。** 跳数、窗口、注入量都是硬上限，达到即终止并给出边界名。违反后果：一次失控循环烧穿整月额度，或者回合永远不结束、智能体永远显示"思考中"。

**决策三：失败必须被看见且不重复轰炸。** 失败写一条去重提示（同一房间同一输入 6 小时内一次、每小时最多 3 条），运行记为失败并保留原因。违反后果：要么用户永远不知道智能体挂了，要么每次重试都刷一条新错误。

**决策四：回合不可重放，恢复靠收件箱。** 唤醒丢失时不让服务端重放"同一条唤醒"，而是让智能体上线后按已读位置补读。违反后果：重放会让已经发生的发言、建卡、邮件再发生一次。

**决策五：注入是打断，不是旁路。** 中途到达的消息可以打断当前工具批次，被打断的工具结果标注为中断，模型看到的是"被打断"而非"成功"。违反后果：模型以为工具执行完了，继续基于假结果推进。

### 3.5 Flow

下面的伪代码说明一次回合的主干与三条失败分支；权限检查发生在各个工具内部，回合本身只负责按顺序推进与收敛。

```ts
async function runTurn(deps: TurnDeps, agentId: string, reason: WakeReason, budget: TurnBudget): Promise<TurnRun> {
  const run = await deps.runs.start(agentId, reason)                 // stage = created
  try {
    const inbox = await deps.inbox.load(agentId)                     // 只读推进"已见"水位
    if (inbox.isEmpty && !survivesEmptyInbox(reason)) {
      return await deps.runs.finish(run, 'skipped', null)            // 普通唤醒：无信可读即收工
    }
    if (await deps.runs.fingerprintAlreadyCompleted(agentId, inbox)) {
      return await deps.runs.finish(run, 'skipped', null)            // 同一批输入不重复思考
    }

    await deps.workspace.hydrate(agentId)                            // 挂载该智能体的文件视图
    const context = await deps.context.load(agentId, inbox, budget)  // 记忆、技能、名册、历史
    const prompt = await deps.persona.buildSystemPrompt(agentId)

    let history = context.history
    let loopExit: LoopExit | null = null
    for (let hop = 0; hop < budget.maxHops; hop++) {
      if (deps.budgetExceeded(history, budget)) { loopExit = 'budget'; break }
      const reply = await deps.model.respond(prompt, history, budget) // 限流/额度错误在此分类
      const tools = reply.pendingTools
      if (tools.length === 0) {
        if (reply.declaredStatus) { loopExit = 'turn_status'; break }
        if (!(await deps.nudgeForStatus(run))) { loopExit = 'protocol_violation'; break }
        continue
      }
      const outcomes = await deps.tools.executeAll(run, tools)        // 并行执行，可被注入打断
      history = deps.history.append(history, reply, outcomes)
      if (outcomes.some((o) => o.interruptedBySteer)) {
        history = deps.steer.splice(history, await deps.steer.drain(agentId))
      }
    }

    const verdict = await deps.completion.verify(run, loopExit)       // 仅在"声明完成但未发言且有副作用"时运行
    if (!verdict.accepted) {
      return await deps.runs.finish(run, 'failed', loopExit, 'TURN_COMPLETION_REJECTED')
    }
    return await deps.runs.finish(run, statusFor(loopExit), loopExit)
  } catch (error) {
    // 失败分类：限流与额度 -> skipped + 去重提示；其余 -> failed + 去重提示
    await deps.notices.raiseOnce(agentId, run, classify(error))
    return await deps.runs.finish(run, isQuota(error) ? 'skipped' : 'failed', null, errorText(error))
  } finally {
    await deps.workspace.commit(agentId)                              // 文件视图落盘；失败只告警不改变终态
    await deps.status.setAvail(agentId)
  }
}
```

分支说明：`load` 在读取时推进"已见"水位，探针式读取不推进；`fingerprintAlreadyCompleted` 命中说明同一批输入刚刚处理过，直接跳过而不是重新思考；`budgetExceeded` 在每跳之前判断，超过硬水位以 `budget` 收尾；`executeAll` 中任一工具被协调闸门拒绝时结果带 `exitCode: 2`，模型据此改写或收手；`finally` 的落盘失败只记事件，不把已完成的回合改成失败。

### 3.6 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 同一批输入重复唤醒 | 输入指纹（内存 + 运行记录双份） | 命中即 `skipped`，不重复调用模型 |
| 唤醒重复投递 | 每条消息一个唤醒声明，60 秒租约 | 只允许一个副本扇出，其余忽略 |
| 回合中途崩溃 | 运行记录停留在 `running` 并持续心跳 | 心跳超时后标记为失败；下次唤醒从收件箱重新装载 |
| 工具已执行但结果未回写 | 工具输出带副作用清单，写入运行事件 | 以副作用清单为准对账，不以模型叙述为准 |
| 注入积压 | 单回合批次与字节上限 | 超限延后到下一次唤醒，不丢弃、不重复 |
| 单回合刷屏 | 每回合每房间发言上限 2 条，超出即拒绝 | 模型收到拒绝原因，改为等待下一回合 |

恢复原则：**宁可少说一次，不可多说一次。**所有"可能已经发生"的动作按已发生处理；不确定是否发生时不重试副作用，而是重新读取世界状态再决定。

### 3.7 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| T-01 | 智能体有未读消息，宿主在线 | 触发一次唤醒 | 产生一条运行记录与完整事件时间线；运行以 `completed` 或明确的终态结束；模型调用可在台账中查到 |
| T-02 | 同一批输入刚刚处理完 | 一分钟后重复唤醒 | 命中指纹，运行记为 `skipped`，无新的模型调用，房间无重复发言 |
| T-03 | 模型连续两次未声明终态就停止 | 完成本次回合 | 先收到两次状态提醒，仍未声明则记为 `failed` 且错误码为 `TURN_PROTOCOL_VIOLATION`；不产生伪造的回复 |
| T-04 | 上下文达到硬水位 | 继续一次回合 | 以 `budget` 终止，运行记为失败并附边界名；下一次唤醒从干净上下文开始，不继承超限历史 |
| T-05 | 回合中收到注入消息 | 工具批次执行中 | 当前批次被中断，被中断的工具结果标注为中断；注入内容在下一跳可见；没有工具结果被伪装成成功 |
| T-06 | 模型服务返回 429 | 发起模型调用 | 回合记为 `skipped`，房间出现一条去重的一次性提示；一小时内同一房间不重复提示，且不触发重试风暴 |
| T-07 | 回合声明完成但只产生了副作用、没有发言 | 进入复核 | 复核不通过则打回继续思考；仍不通过则 `failed`，运行事件包含 `TURN_COMPLETION_REJECTED` |
