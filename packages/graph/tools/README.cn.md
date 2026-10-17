# @deepseek-ai/dsh-graph-tools

把 flow 引擎暴露成模型可见的内置工具：`graph_list`、`graph_run`、`graph_status`。需要让 agent 自己列出已注册工作流、按名启动一次运行、读取运行状态时用它；工作流由宿主代码、定时任务或其它触发器启动时不需要它。

## 提供什么

- **`graph_list`** —— 无参数；返回引擎中已注册的全部 flow（`id`、节点数、边数、声明的输出变量名），模型据此知道 `graph_run` 可以传哪些名字。
- **`graph_run`** —— 参数 `name`（flow id）与可选 `input`（JSON 对象，按 flow 的 Start 签名校验）。启动运行并最多等待 `runTimeoutMs`，返回 `flowId`、`runId`、`status`、解析后的 `output`、每节点状态与结构化错误；预算到期时返回 `status: "running"`，运行继续在后台跑。
- **`graph_status`** —— 参数 `runId`；返回同一种载荷：运行中只有状态，完成后带输出与节点记录。
- **失败要说清楚** —— 未知 flow（`GRAPH_FLOW_NOT_FOUND`，附带可用 id 列表）、未知 run（`GRAPH_RUN_NOT_FOUND`，附带最近 run id）以及非对象 `input`（`GRAPH_INPUT_INVALID`）都变成普通的工具失败，而不是猜一个默认值。
- **只是能力消费方** —— 只读 `FlowEngine` 服务，自己不碰存储、内核或文件系统。每个注册都走 `ctx.effect`，随 fiber 逆序注销。

## 用法

```yaml
- name: "@deepseek-ai/dsh-graph-tools"
  config:
    runTimeoutMs: 60000
```

配置：`runTimeoutMs`（默认 60 000 毫秒）只约束 `graph_run` 等待多久，不会因为超时取消运行。

插件注入两项能力，因此二者必须先挂载：DSH 工具注册表（`ctx.tools`，来自 `@deepseek-ai/dsh-tools`）与 flow 引擎（`graphFlowEngine`，来自 `@deepseek-ai/dsh-graph-flow-engine`）。可运行的 flow 来自 `@deepseek-ai/dsh-graph-flow-yaml`（YAML 文件）或宿主代码调用 `registerFlow`。

## 非目标

不做自主触发的 flow 启动器（引擎的 `flow/run-starting` 事件是那个扩展点）；不做 flow 编写/编辑工具；不做显式取消工具（`graph_run` 只在自己的调用被中断时取消它启动的那次运行）；没有客户端 UI。

中文文档即本文件；英文见 [README.md](./README.md)。
