# @deepseek-ai/dsh-graph-flow-yaml

Loads flow definitions from YAML files into the flow engine at plugin startup. Use it when flows are authored as declarative YAML documents (files on disk) and should be registered into `@deepseek-ai/dsh-graph-flow-engine` automatically — with reverse-order unregistration via `ctx.effect`. Skip it when flows are built in code or persisted by `@deepseek-ai/dsh-graph-flow-storage`.

## What it provides

- **`graphFlowYaml` plugin** — `Config.files`: YAML flow file paths, loaded sequentially in an async effect (awaiting the plugin waits for the loads); a failing file logs and does not block the rest.
- **`FlowYamlLoader` capability** (`FlowYamlLoaderToken`) — `loadFile(path)` for programmatic loading.
- **`flowFromYaml`** — validates and maps a parsed YAML document: `id`, `nodes` (`type`, `version`, `config`, `input`, `retry`, `timeout`, `onError`, `fallbackValue`), `edges` (`from`, `to`, `port`), `output` slot references. Malformed documents fail loud with `FLOW_YAML_INVALID`; deeper validation (unknown types, bad configs, cycles) happens at engine compile time (`NODE_TYPE_NOT_FOUND`, `NODE_CONFIG_INVALID`, `FLOW_CYCLE_DETECTED`).

## Usage

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
import { apply as kernel } from '@deepseek-ai/dsh-graph-core';
import { apply as engine } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as yamlParser } from '@veren/yaml-parser';
import { apply as flowYaml } from '@deepseek-ai/dsh-graph-flow-yaml';

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(engine, {});
await ctx.plugin(yamlParser);
await ctx.plugin(flowYaml, { files: ['flows/demo.flow.yaml'] });
```

## Non-goals (phase 2)

Node config schemas and the flow input schema are runtime objects and stay out of YAML (validation lives at engine compile time); no expression language beyond `${nodeId.slot}`; no hot file watching.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
