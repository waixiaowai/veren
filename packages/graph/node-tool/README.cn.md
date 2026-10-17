# @deepseek-ai/dsh-graph-node-tool

通用 **tool 节点**：DSH 工具注册表（`ctx.tools`）里已注册的每个工具——bash、pwsh、fs、web……——都成为一个 flow 节点类型。当 flow 需要复用 DSH 已注册工具（自带沙箱约束、跨平台 shell 选择（mac/win/linux）、环境处理、超时与审批策略）而不是自己实现执行时使用它。只需要内置测试夹具（`@deepseek-ai/dsh-graph-flow-engine` 的 `noop`/`fail`/`echo`/`subflow`）时请跳过。

## 提供什么

- **`tool` 节点类型**（version 1）—— config `{ tool: <已注册工具名> }`；节点的输入映射解析结果作为工具的 `arguments`。
- **复用完整 tools 管线** —— 调用经 `ctx.tools.execute(...)`：`tools/pre-execute` → guards → around-dispatch（超时包装）→ 工具体 → `tools/post-execute`。沙箱约束与跨平台行为来自已装载的 DSH 工具/沙箱后端插件，本包不实现。
- **取消传播** —— handler 从节点的 `AbortSignal` 派生调用 signal：外部取消会中止正在运行的工具，fail-fast 通知不会，因此工具兄弟会自然跑完并保持 `completed`。
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
edges: []
```

```ts
const ctx = new Context();
await ctx.plugin(kernelPlugin);
await ctx.plugin(flowEnginePlugin, {});
await ctx.plugin(nodeToolPlugin);        // inject: ['tools'] —— 需先装载 dsh-tools
```

## 非目标（二期）

不做工具发现面（消费方可直接使用 `ctx.tools.schemas()`）；不做逐调用审批 UX——无 agent 的 flow 运行中，需审批的工具按设计降级为拒绝（fail-closed）；canonical value 之外不做结果内容投影。

中文文档即本文件；英文见 [README.md](./README.md)。
