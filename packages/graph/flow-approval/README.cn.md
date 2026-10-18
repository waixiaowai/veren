# @deepseek-ai/dsh-graph-flow-approval

flow 节点授权服务。当 flow 节点必须在执行前等一个人做决定（工具调用、发布、写文件……）时使用它：它实现 `@deepseek-ai/dsh-graph-flow-api` 的授权接缝，让请求真正挂起运行，直到界面回答、超时或运行取消。无人值守、需要保持 fail-closed 的 flow 不要装载它。

## 提供什么

- **`FlowApprovalBroker` 能力**（`graphFlowApproval`）：`open(input, context)` 登记一条请求并返回挂起的 Promise；`answer(requestId, { runId, decision, actor })` 回答；`pending()` 给出当前挂起请求快照。引擎把 `open` 暴露成每个节点尝试的 `nctx.approval`，画布等界面用 Remote 端点调用 `answer`。
- **真正挂起**：`open` 返回的 Promise 在没人回答前不会落定；节点因此停在 `awaiting-approval`，下游不调度，运行仍是 `running`。
- **一次性、按 run 隔离**：请求 id 单次有效；`answer` 要求 `runId` 一致，已回答/未知/跨 run 一律返回 `false`。授权不写任何全局策略。
- **可配超时**：服务级 `timeoutMs`（默认 60 000，0 = 不超时）与每请求 `timeoutMs` 覆盖；超时以 `via: 'timeout'` 自动拒绝。
- **取消即撤销**：运行取消时，请求随信号撤销为 `via: 'cancel'`；迟到回答不再生效。
- **审计最小集**：请求携带 `flowId`/`runId`/`nodeId`/`attempt`/`kind`/`action`/`reason`/`summary`/`requestedAt`/`expiresAt`；结果携带 `decision`/`via`/`decidedBy`/`decidedAt`。
- **事件**：`flow/approval-requested`（请求挂起）与 `flow/approval-decided`（请求落定），都是 `@mode emit`；引擎据此更新节点状态与审计，画布据此渲染/撤下卡片。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as approval } from '@deepseek-ai/dsh-graph-flow-approval';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';

const ctx = new Context();
await ctx.plugin(approval, { timeoutMs: 60_000 });
const broker = ctx.get(FlowApprovalToken)!;

const outcome = await broker.open(
    { kind: 'tool', action: 'bash', reason: 'publishes artifacts', summary: '{"command":"pnpm publish"}' },
    { flowId, runId, nodeId, attempt: 1, signal },
);
// outcome: { decision: 'allow' | 'deny', via: 'user' | 'timeout' | 'cancel' | 'unavailable', decidedBy?, decidedAt }
```

节点 handler 通常不直接依赖本包：引擎已经把 `open` 包装成 `NodeExecuteContext.approval`，handler 只调用 `nctx.approval.request(...)`。

## 非目标

不提供 UI（画布在 `@deepseek-ai/dsh-graph-flow-canvas-panel` 渲染卡片）、不做策略判断（“是否需要授权”由工具管线或节点 config 决定）、不持久化授权历史（审计存在于运行记录 `FlowNodeRecord.approvals` 与事件里）、不改变 DSH 的 `ApprovalService`/permission preset。

中文文档即本文件；英文见 [README.md](./README.md)。
