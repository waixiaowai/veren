# @deepseek-ai/dsh-graph-node-tool

通用 **tool 节点**：DSH 工具注册表（`ctx.tools`）里已注册的每个工具——bash、pwsh、fs、web……——都成为一个 flow 节点类型。当 flow 需要复用 DSH 已注册工具（自带沙箱约束、跨平台 shell 选择（mac/win/linux）、环境处理、超时与审批策略）而不是自己实现执行时使用它。只需要内置测试夹具（`@deepseek-ai/dsh-graph-flow-engine` 的 `noop`/`fail`/`echo`/`subflow`）时请跳过。

## 提供什么

- **`tool` 节点类型**（version 1）—— config `{ tool: <已注册工具名> }`；节点的输入映射解析结果作为工具的 `arguments`。
- **复用完整 tools 管线** —— 调用经 `ctx.tools.execute(...)`：`tools/pre-execute` → guards → around-dispatch（超时包装）→ 工具体 → `tools/post-execute`。沙箱约束与跨平台行为来自已装载的 DSH 工具/沙箱后端插件，本包不实现。
- **需要授权时挂起，而不是 fail-closed** —— 两条路径，共用 flow 层的授权面：
  1. **管线 `ask`**：本插件用 prepend 的 `tools/pre-execute` 监听器读到下游策略给出的 `ask`，把它变成节点授权卡上的问题；非 flow 调用（agent 的工具调用）原样透传。
  2. **显式 `approval.require`**：节点 config 要求调用前必须授权（即使管线没有 `ask` 策略）。
  请求真正挂起该节点与它的下游：运行保持 `running`，节点进入 `awaiting-approval`，画布渲染授权卡。同意 → 工具继续执行并完成；拒绝 → 节点以 `NODE_PERMISSION_DENIED` 失败，按既有 `retry`/`onError` 策略处理。
- **取消传播** —— handler 从节点的 `AbortSignal` 派生调用 signal：外部取消会中止正在运行的工具并撤销挂起的授权；fail-fast 通知不会，因此工具兄弟会自然跑完并保持 `completed`。
- **结构化结果** —— 成功的 canonical JSON `value` 摊平写入黑板 slot（对象按键摊平；标量/数组落在 `out`）；失败以工具的稳定 `info.code` 抛出（兜底 `TOOL_FAILED`），贯穿 `retry`/`onError` 并体现在 `FlowRunResult.error.code`。
- **无令牌封装** —— 节点直接读取 `ctx.tools`（经 dsh-tools 的 declaration merge 获得类型面）；测试在同名 `'tools'` 服务下提供替身。

## 用法

```yaml
id: ci
nodes:
  - id: run-tests
    type: tool
    config: { tool: bash }
    input: { command: "pnpm test" }   # → 工具参数
    retry: { tries: 2 }

  # 显式要求授权：即使 bash 本身没有 ask 策略，也会先挂起等人工决定
  - id: publish
    type: tool
    config:
      tool: bash
      approval:
        require: true
        reason: "发布会改动工作区之外的产物"
        timeoutMs: 120000              # 可选；0 = 不超时
    input: { command: "pnpm publish" }
edges:
  - { from: run-tests, to: publish }
```

```ts
const ctx = new Context();
await ctx.plugin(kernelPlugin);
await ctx.plugin(flowEnginePlugin, {});
await ctx.plugin(approvalPlugin, { timeoutMs: 60_000 }); // 提供 graphFlowApproval
await ctx.plugin(nodeToolPlugin);        // inject: ['tools'] —— 需先装载 dsh-tools
```

## 授权的安全边界

- **一次性**：回答只消费当前请求；同一个请求 id 第二次回答一定失败（画布收到 `flow-canvas/approval-not-found`）。
- **按 run + 节点尝试隔离**：请求记录 `flowId`/`runId`/`nodeId`/`attempt`；回答必须带同一 `runId`，并发运行/并发节点互不串号。
- **不改变全局策略**：授权不会写 permission preset、sandbox mode 或 approval policy；它只决定这一次工具调用是否执行。
- **超时自动拒绝**：默认由 `@deepseek-ai/dsh-graph-flow-approval` 的 `timeoutMs` 决定（60 秒），节点 config 可覆盖；等待期间节点执行超时暂停，所以等待不会被 `nodeTimeoutMs` 提前打断。
- **取消即撤销**：run 取消会撤销挂起请求（`via: 'cancel'`），节点落 `cancelled`。
- **审计最小集**：每次授权记录请求（工具、参数摘要、原因、时间）与结果（同意/拒绝、回答者、时间、来源）。拒绝与超时分别是稳定错误码 `NODE_PERMISSION_DENIED` 与 `NODE_APPROVAL_TIMEOUT`；没有可用授权通道时为 `NODE_APPROVAL_UNAVAILABLE`。

## 与 DSH 现有审批的关系

状态判断完全复用 tools 管线的 `tools/pre-execute` 与 `PreToolDecision` 的 `ask` 词汇；不新增工具层审批协议。DSH 的 `ApprovalService.request` 要求一个真实 `Agent`、已打开的 turn 与会话审计日志，而画布里的无 agent flow run 不满足这些前提（正是旧行为 fail-closed 的原因），因此 flow 层用 `@deepseek-ai/dsh-graph-flow-approval` 承载请求/回答，并把结果翻译回既有的 `allow`/`deny` 决定。未装载该服务时仍然拒绝（`NODE_APPROVAL_UNAVAILABLE`），fail-closed 语义不变。

## 非目标（二期）

不做工具发现面（消费方可直接使用 `ctx.tools.schemas()`）；不做跨运行/跨节点的长期授权（授权永远一次性）；不做结果内容投影（canonical value 之外不加工）；不改 harness 内核审批协议。

中文文档即本文件；英文见 [README.md](./README.md)。
