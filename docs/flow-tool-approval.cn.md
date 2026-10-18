# flow 工具节点授权：挂起、卡片、放行

本文记录 `graph` 插件族里 **flow 节点授权** 的现状、实现与验证。适用读者：维护 `packages/graph/*` 的开发者，以及部署 graph bundle 的用户。

## 之前 / 现在 / 证明

**之前**：`tool` 节点经 `ctx.tools.execute` 走完整 tools 管线。tools 管线的 `ask` 判据最终由 `ApprovalService.request` 处理，而它要求真实 `Agent`、已打开的 turn 与会话审计日志。画布里的 flow run 没有 agent，因此 `serviceAsk` 直接返回 deny——`node-tool` 的 README 把这条写成“按设计 fail-closed”。

**现在**：需要授权时，run 在该节点**真挂起**：

1. 节点进入可辨识的 `awaiting-approval`（flow 层状态；内核仍视作 `running`），下游不调度，run 保持 `running`；
2. 画布在该节点上渲染授权卡：工具/动作、参数要点、原因、请求与超时时间、「同意」「拒绝」；
3. 同意 → 工具继续执行、节点 `completed`、流程继续；拒绝 → 节点以 `NODE_PERMISSION_DENIED` 失败（超时为 `NODE_APPROVAL_TIMEOUT`），按既有 `retry`/`onError` 策略处理；
4. 授权只对**这一 run 的这一次调用**有效；超时自动拒绝；run 取消即撤销；
5. 授权卡是节点渲染的扩展：内置默认卡片带卡，第三方通过 `flow.canvas.node` 的 owner props（`pendingApproval` / `approvals` / `onApprovalDecision`）或导出的 `NodeApprovalCard` 自行实现。

**证明**：

- `pnpm -r --filter "./packages/graph/*" test` → 12 个包全绿，**208 spec**（原有 161 个全部保留通过，新增 47 个）。
- 一次性隔离节点 `C:\Users\imeep\.dsh_test_flow_approval`（3097，bundle + panel 0.1.10 + 仅测试夹具）真点：显式 require 允许、管线 `ask` 拒绝、5 秒超时、挂起中取消；截图在 `packages/graph/flow-canvas-panel/docs/approval-*.png`。验证后节点已删除，3080 未触碰。

## 架构（复用了什么、新增了什么）

```
node handler ──nctx.approval.request()──▶ flow-approval (graphFlowApproval)
      ▲                                        │ 挂起 / 超时 / 取消 / 一次性回答
      │                                        ▼
node-tool ──tools/pre-execute (prepend)──▶ 既有的 ask 判据
      │                                        │
      └────────── 授权卡问题 ◀── flow/approval-* 事件 ──▶ flow-engine（awaiting 状态 + 审计）
                                                          │
                                     flow-canvas 投影 ◀───┘
                                                          │
                            flow-canvas-panel Remote `answer` / `cancel`
```

- **复用 1：tools 管线**。`ask` 的判定完全来自既有 `tools/pre-execute` waterfall 与 `PreToolDecision` 的 `ask` 词汇；`node-tool` 用 `prepend` 监听器读到下游策略的最终决定，把 `ask` 翻译成节点问题，再把人的回答翻译回既有 `allow`/`deny`。**没有新增工具层审批协议**。
- **复用 2：DSH 审批语义**。`allowed-once` 的一次性授权、按 action 授权、超时/取消、审计（谁/何时）这些语义与 DSH `ApprovalService` 保持一致；只是承载位置换到 flow 层。
- **新增 1：`@deepseek-ai/dsh-graph-flow-approval`**。`FlowApprovalBroker` 的实现：`open`/`answer`/`pending`、可配超时、取消撤销、一次性回答、`flow/approval-requested` 与 `flow/approval-decided` 事件。
- **新增 2：flow-api 授权接缝**。`FlowApprovalRequest/Outcome/Audit`、`FlowNodeApprovalPort`、`FlowApprovalBroker`、`FlowApprovalToken`；`NodeExecuteContext.approval` 让**任何节点类型**都能请求授权，而不是只有 `tool`。
- **新增 3：flow 层挂起状态与审计**。`FlowNodeStatus = GraphNodeStatus | 'awaiting-approval'`；`FlowNodeRecord.approvals` 保存请求与结果；节点执行超时在等待期间暂停，避免“等人”被 `nodeTimeoutMs` 打断。
- **新增 4：画布授权卡与回答端点**。`flowCanvas/answer`、`flowCanvas/cancel`；节点卡片下方渲染卡片；节点上保留最小审计，检查器列出全部记录。
- **新增 5：`node-tool` 的两条触发**。管线 `ask` 自动接管；`config.approval.require` 提供显式的逐节点要求（`reason`、`timeoutMs`）。

## 为什么不是直接用 `ApprovalService`

`ApprovalService.request` 的前置条件是真实 `Agent` 与**已打开的 turn**（审计对必须被 turn 包住，否则重启后是 crash-tail）。无 agent 的 flow run 既没有 session 也没有 turn；给 flow 伪造 Agent/Session 会把审计写进错误的会话，属于改 DSH 内核语义。因此：

- **没有修改 `deepseek/deepseek-harness` 任何文件**（本工作区对 harness 的改动为零；`git status` 里的 harness 变更均早于本任务）。
- flow 层用同一个 `PreToolDecision` 词汇和同样的一次性授权语义，自己持有请求/回答与审计。未装载 `flow-approval` 时 `approval.request` 返回 `via: 'unavailable'`，调用被拒绝（`NODE_APPROVAL_UNAVAILABLE`），fail-closed 不放松。

## 安全边界

| 边界 | 实现 |
|---|---|
| 授权范围 | 每次 `open` 生成唯一 request id；`answer` 必须带同一 `runId`；回答后立即从 pending 表删除。不写 permission preset / sandbox mode / approval policy。 |
| 并发隔离 | 请求按 `(runId, nodeId, attempt, id)` 归属；节点侧用调用 signal 精确匹配在途工具调用。两个 run、两个节点、同一节点的两个并发请求都互不串号。 |
| 超时 | 服务默认 `timeoutMs: 60000`（0 = 不超时），节点 `approval.timeoutMs` 可覆盖；超时以 `via:'timeout'` 自动拒绝。等待期间节点执行超时暂停。 |
| 取消 | run 取消 → 请求随信号撤销为 `via:'cancel'`；节点落 `cancelled`；迟到回答返回 `false`（画布得到 `flow-canvas/approval-not-found`）。 |
| 审计最小集 | 请求：`flowId/runId/nodeId/attempt/kind/action/reason/summary/requestedAt/expiresAt`；结果：`decision/via/decidedBy/decidedAt`。审计随运行结果持久化（`stores/runs`），刷新后仍可见。 |
| 卸载 | flow-approval 卸载时撤销全部挂起请求；节点超时监听器在节点落定后移除（有 spec 断言）。 |
| 授权 UI 扩展 | owner props 为普通数据 + 回调；第三方渲染器可完全替换卡片，仍走同一条 Remote `answer` 路径。 |

## 行为细节

- **等待期间的状态序列**：`pending → ready → running → awaiting-approval → running → completed`（拒绝/超时则为 `failed`）。画布投影对 `awaiting-approval` 与 `running` 同级排序，所以授权落定后允许回到 `running`；终态仍然吸收迟到事件。
- **同一节点的多个并发请求**：全部进入 `approvals`；只要还有未落定请求，节点保持 `awaiting-approval`（有 spec）。
- **fail-fast**：失败传播会撤销挂起的授权（run 已经失败，继续等一个无法改变结果的决定没有意义），节点按失败收尾；这与“运行中的兄弟分支仍跑完”的既有语义不同，因为等待授权不是可自然完成的执行。授权审计记为 `via: 'cancel'`，与显式取消共用“因运行取消而撤销”的文案。
- **重试**：每次尝试都会重新请求授权；审计按发生顺序累积，卡片刻画最后一次挂起。
- **持久化**：`FlowRunResult.nodes[id].approvals` 随运行记录落盘，隔离节点里验证过 allow/deny/timeout/cancel 四种结果都在 `storages/graph_flow.json` 中。

## 验证清单

| 场景 | spec | GUI |
|---|---|---|
| 挂起 + 同意 + 完成 + 审计 | engine / node-tool / canvas / panel | `approval-card.png`、`approval-approved.png` |
| 管线 `ask` 被接管 | node-tool gate + 真实事件组合 | `approval-ask-policy.png` |
| 拒绝 → `NODE_PERMISSION_DENIED` + 下游跳过 | engine / node-tool | `approval-denied.png` |
| 超时 → `NODE_APPROVAL_TIMEOUT` | flow-approval / engine / node-tool | `approval-timeout.png` |
| 取消 → 撤销挂起 + `cancelled` | flow-approval / engine / node-tool / canvas | `approval-cancelled.png` |
| 并发互不串号 | flow-approval / engine / node-tool | — |
| 一次性回答 / 跨 run 拒绝 | flow-approval | — |
| 审计字段 | flow-approval / engine / panel model | 截图中节点/检查器 |
| 第三方渲染器请求/回答 | panel jsdom | — |
| 卸载清理 | flow-approval / engine | — |

## 一句话

**现在一个人可以在画布上看到它卡住、点一下放行。**
