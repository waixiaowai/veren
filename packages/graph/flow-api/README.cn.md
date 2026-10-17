# @deepseek-ai/dsh-graph-flow-api

flow 语义层的最小 API（纯类型面）。当你编写 **flow 节点类型插件**，或只需要 flow 词汇表而不想要任何实现时使用它：节点插件只 import 本包的类型并注入 `NodeRegistryToken`，禁止依赖实现包 `@deepseek-ai/dsh-graph-flow-engine`。

## 提供什么

- **品牌 id**（零运行时开销）：`FlowId`、`RunId`、`NodeId`；`SlotRef`（`${nodeId.slot}`，一期唯一表达式）。
- **`FlowDefinition`** —— `id`、可选 `input` schema（schemastery，即 Start 签名）、`output` slot 引用（End 签名）、`nodes`、`edges`（只表达依赖顺序，可选 `port` 命名输出端口与 `when` 条件）。
- **`FlowNodeDef`** —— `type`、固定 `version`、`config`、显式 `input` 映射（slot 引用或字面量）、`onError`（`failFast | fallback | errorBranch`）、`fallbackValue`、`retry { tries, backoffMs }`、`timeout`。
- **`NodeHandler`** —— `type`、`version`、`config`（schemastery schema）、`execute(input, nctx)`；返回命名输出 slot（对象），非对象返回值落在 `out`。
- **`NodeExecuteContext`** —— 节点作用域 `ctx`、`flowId`、`runId`、`nodeId`、`attempt`、已校验 `config`、`blackboard`、`signal`。
- **`FlowBlackboard`** —— 命名 slot 读写；边不传值。
- **`NodeRegistry` + `NodeRegistryToken` + `registerNodeHandler(ctx, handler)`** —— 经 `ctx.effect` 注册，卸载逆序清理（HMR 安全）。

## 用法（节点类型插件）

```ts
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { NodeRegistryToken, registerNodeHandler, type NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';

export const name = 'myUpperNode';
export const inject = [NodeRegistryToken] as const;

const handler: NodeHandler<{ upper: boolean }> = {
    type: 'upper',
    version: 1,
    config: z.object({ upper: z.boolean().default(true) }),
    execute: (input) => ({ out: String(input['text']).toUpperCase() }),
};

export const apply = (ctx: Context) => {
    registerNodeHandler(ctx, handler);
};
```

## 非目标（二期）

类型声明 + 绑定到 ctx.effect 的注册帮助函数 —— 不含注册表/引擎实现、不含触发器、除 `${nodeId.slot}` 外无表达式语言、除中性模型外无画布类型。

中文文档即本文件；英文见 [README.md](./README.md)。
