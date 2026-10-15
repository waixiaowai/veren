# @veren/graph-flow-yaml

在插件启动时把 YAML 文件中的 flow 定义装载进 flow 引擎。当 flow 以声明式 YAML 文档（磁盘文件）编写、并希望自动注册进 `@veren/graph-flow-engine` 时使用它——注销经 `ctx.effect` 逆序清理。flow 由代码构建或由 `@veren/graph-flow-storage` 持久化时请跳过。

## 提供什么

- **`graphFlowYaml` 插件** —— `Config.files`：YAML flow 文件路径，在异步 effect 内顺序装载（`await ctx.plugin` 会等待装载完成）；单个文件失败记日志、不阻断其余文件。
- **`FlowYamlLoader` 能力**（`FlowYamlLoaderToken`）—— `loadFile(path)`，可编程装载。
- **`flowFromYaml`** —— 校验并映射解析后的 YAML 文档：`id`、`nodes`（`type`、`version`、`config`、`input`、`retry`、`timeout`、`onError`、`fallbackValue`）、`edges`（`from`、`to`、`port`）、`output` slot 引用。结构错误响亮失败（`FLOW_YAML_INVALID`）；更深层校验（未知类型、坏配置、环）由引擎编译期完成（`NODE_TYPE_NOT_FOUND`、`NODE_CONFIG_INVALID`、`FLOW_CYCLE_DETECTED`）。

## 用法

```yaml
# flows/demo.flow.yaml
id: demo
nodes:
  - id: src
    type: echo
    config: { message: hi }
  - id: sink
    type: noop
    input: { said: "${src.message}" }
edges:
  - { from: src, to: sink }
output:
  said: "${sink.said}"
```

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@veren/graph-core';
import { apply as engine } from '@veren/graph-flow-engine';
import { apply as yamlParser } from '@veren/yaml-parser';
import { apply as flowYaml } from '@veren/graph-flow-yaml';

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(engine, {});
await ctx.plugin(yamlParser);
await ctx.plugin(flowYaml, { files: ['flows/demo.flow.yaml'] });
```

## 非目标（二期）

节点 config schema 与 flow 入参 schema 是运行时对象，不进 YAML（校验在引擎编译期完成）；除 `${nodeId.slot}` 外无表达式语言；不做文件热监听。

中文文档即本文件；英文见 [README.md](./README.md)。
