# @veren/yaml-parser

[English](./README.md)

把 YAML 解析变成 Veren 工具链的 Cordis 上下文服务：装上 Provider 后，通过上下文解析
YAML 文档，而不是各自直接引入 YAML 库。

## 何时使用

- 基于 Cordis 的应用或流水线需要把 YAML 文档（配置文件、清单）解析为普通 JS 值，
  且解析能力要能通过上下文替换。
- 多个包都需要 YAML 解析，应共享同一个 Provider，而不是各引各的 YAML 库。
- 你在编写另一个 `@veren` Provider，其配置文件是 YAML，希望像其他服务一样消费解析能力。

如果不在 Cordis 上下文中、只是偶尔解析一次，请跳过本包 —— 直接使用 `yaml` 包。

## 安装

本包属于 pnpm workspace，请在消费方的 `package.json` 中通过 workspace 协议声明依赖：

```json
{
  "dependencies": {
    "@veren/yaml-parser": "workspace:*"
  }
}
```

本包声明 `inject = []`，可以作为任何流水线的第一个插件；不依赖任何其他服务。

## 快速开始

```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'

const ctx = new Context()
await ctx.plugin(YamlParser, { intAsBigInt: true }) // 配置经 Config schema 校验

const parser = ctx.get(YamlParser.name)!
parser.parse('scan:\n  - apps\n') // { scan: ['apps'] }
parser.parse('')                  // null —— 空文档
```

Provider 遵循与 `@veren/compiler-*` 相同的仓库约定：`name` 是服务令牌，`inject` 列出
依赖服务，`Config` 是 `@deepseek-ai/schemastery` 定义的 schema，负责校验并归一化插件
配置，`apply(ctx, config)` 把解析服务提供到上下文。fiber 异步激活，`await ctx.plugin(...)`
之后服务才就绪；不传配置装载时，所有字段取 schema 默认值。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `Token<YamlParser>`，字符串 `'verenYamlParser'` | 解析服务注册到的令牌。 |
| `inject` | `Token[]` | `[]`：解析服务不依赖任何服务，可最先激活。 |
| `Config` | Schemastery schema 与 `interface Config` | 用 `@deepseek-ai/schemastery` 校验并归一化插件配置。字段均为布尔值，默认值取 yaml 文档缺省值：`intAsBigInt` `false`、`keepSourceTokens` `false`、`prettyErrors` `true`、`strict` `true`、`stringKeys` `false`、`uniqueKeys` `true`。字段类型不合法抛错；未知字段原样透传。`Config({})` 返回完整默认集。 |
| `apply(ctx, config)` | `(ctx: Context, config?: Config) => () => void` | 用 `createYamlParser(config)` 创建解析服务并以 `name` 提供。返回的 disposer 用于取消提供。 |
| `YamlParser` | `interface { parse<T>(text: string): T }` | 消费方从上下文取得的服务接口。 |
| `createYamlParser(options)` | `(options?: ParseOptions) => YamlParser` | Provider 背后的纯工厂；也可脱离上下文使用。 |

## 开发

```bash
pnpm --filter @veren/yaml-parser build
pnpm --filter @veren/yaml-parser test
```

测试位于 `test/index.test.ts`，通过 `vitest run` 运行：Provider 测试（令牌形态、schema
归一化与校验、提供、disposer、带/不带配置的 `ctx.plugin` 集成）与服务测试（标量/序列/
映射、空文档、`intAsBigInt`、`uniqueKeys`、坏输入），共 14 用例。

```
packages/yaml-parser
├── README.md           # 英文文档
├── README.cn.md        # 中文文档
├── package.json
├── src/
│   ├── index.ts        # Provider 入口：name / inject / Config / apply
│   └── parser.ts       # YamlParser 服务接口 + createYamlParser 工厂
└── test/
    └── index.test.ts   # 14 个用例
```

构建产物由 `tsc` 输出到 `dist/`；`main` 与 `exports` 都指向 `./dist/index.js`。

## 注意事项与约束

- 令牌就是普通字符串，带 `veren` 前缀，因此不会跨包重名。
- `Config` schema 只暴露 yaml 中可声明的布尔型 `ParseOptions`；`lineCounter`、
  `uniqueKeys` 比较器等运行时对象不进入配置，保持配置可声明、可序列化、可校验。
  未知配置字段按 schemastery 约定原样透传，不会被拒绝。
- `parse` 每次只解析单个文档；空文档解析为 `null`，调用方应使用 `?? {}` 兜底
  （`@veren/cli` 读取 `.veren.yaml` 时正是如此）。
- 首个消费方 `@veren/cli` 通过本服务读取 `.veren.yaml`；`yaml` 依赖收敛在本包内，
  不再出现在 CLI 中。
- 同一个 `Context` 上重复 provide 同名服务会抛 `service already registered`，
  需要先 dispose 上一次注册。
