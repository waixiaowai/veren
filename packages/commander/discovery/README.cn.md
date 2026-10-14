# @veren/commander-discovery

[English](./README.md)

veren 工作区单元发现 —— 标准 Cordis 插件模块：`DiscoveryService`（继承 `Service`，提供 `list`/`find`）按文件约定（`package.json` 优先于 `Cargo.toml`）识别工作区单元 `{ name, description, dir }`，带深度上限、按
`dir` 排序；纯扫描函数同时保留。

## 何时使用

- 某个 Cordis 插件需要把工作区单元作为结构化数据（veren CLI 的 `list`/`doc`
  命令即注入本服务）。
- 你希望 npm 优先于 Rust、深度上限、跳过名单（`node_modules`、`dist`、
  `target`、隐藏目录）这些约定被一致地应用，并可通过插件配置微调。

如果使用其他工具扫描工作区，请跳过本包。

## 安装

```json
{
  "dependencies": {
    "@veren/commander-discovery": "workspace:*"
  }
}
```

## 快速开始
```ts
import { Context } from '@deepseek-ai/cordis'
import { getOrThrow } from '@veren/core'
import { Project } from '@veren/commander-project'
import { Discovery } from '@veren/commander-discovery'
import * as DiscoveryPlugin from '@veren/commander-discovery'

const ctx = new Context()
ctx.provide(Project, { root: '/path/to/project', config: { scanRoots: ['/path/to/project/apps'] } })
await ctx.plugin(DiscoveryPlugin) // inject = [Project]；Config：{ maxDepth, skip }

const units = await getOrThrow(ctx, Discovery).list()
// [{ name: '@x/pkg', description: '…', dir: 'apps/pkg' }, …]
await getOrThrow(ctx, Discovery).find('@x/pkg') // 单元 | undefined
```

非插件调用方也可以直接用纯函数：

```ts
import { discoverUnits } from '@veren/commander-discovery'

const units = await discoverUnits(fs, path, '/path/to/project', { scanRoots: ['/path/to/project/apps'] })
```

## 令牌子路径（平台无关）
`./tokens` 只导出 `Discovery` 令牌及其结构化视图 `UnitInventory` / `Unit` —— 不含 Cordis、不含 Node 内置模块 —— 可干净地打进浏览器或其他只需要引用服务名
的环境：

```ts
import { Discovery } from '@veren/commander-discovery/tokens' // 只有令牌，不拖入 Cordis
```

## 接口

模块即插件 —— 以命名空间导入装载（`ctx.plugin(...)`）：

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | 字符串（`'verenCliDiscovery'`） | 服务令牌（即 `Discovery`）兼插件显示名。 |
| `inject` | `[Project]` | 依赖项目服务（项目根与扫描根）。 |
| `Config` | schemastery schema | `{ maxDepth: number, skip: string[] }` —— 扫描深度上限（缺省 `4`）与在 `SKIP_DIRS` 之外追加跳过的目录名（缺省 `[]`）。 |
| `apply(ctx, config)` | 插件函数 | 从上下文的 `Project` 创建 `DiscoveryService`。 |
| `Discovery` | 令牌，字符串 `'verenCliDiscovery'` | `DiscoveryService` 的提供令牌。 |
| `DiscoveryService` | 继承 `Service` 的类 | `list()`（按 `dir` 排序的单元，每次调用重新扫描）、`find(name)`、`listDependencies(name)`（子包 `dependencies` 解析出的单元：工作区条目 + 来自 `node_modules` 的第三方包）、`root`（项目根）、`config`（归一化配置）。 |
| `UnitInventory` | 接口 | 令牌级结构视图（来自 `./tokens`）：`root`/`list`/`find`/`listDependencies`，无 Cordis 依赖。 |
| `discoverUnits(fs, path, root, config, options?)` | 函数 | 纯扫描：递归扫描每个扫描根，按 `dir` 排序；`options` = `{ maxDepth?, skip? }`。 |
| `ScanConfig` | 接口 | `{ scanRoots: string[] }` —— 最小扫描形状（与 `@veren/commander-project` 的 `Config` 结构兼容）。 |
| `ScanOptions` | 接口 | `{ maxDepth?, skip? }` —— 可选的单次扫描覆盖项。 |
| `Unit` | 接口 | `{ name, description, dir }`；`dir` 为相对根、以正斜杠分隔的路径。 |
| `readNpmUnit` / `readCargoUnit` | 函数 | 从 `package.json` / `Cargo.toml` 读取单个单元；非单元返回 `null`（坏清单向 stderr 告警）。 |
| `parseCargoPackageFields` | 函数 | 零依赖提取 `[package]` 的 `name`/`description`（双引号转义、单引号字面量、行尾注释）。 |
| `parseNpmDependencyNames` / `readUnitDependencyNames` | 函数 | 从子包自身 `package.json` 的 `dependencies` 读取依赖名（去重）；读取函数接受单元目录（绝对路径），无 `package.json` 时返回 `[]`。 |
| `MAX_SCAN_DEPTH` / `SKIP_DIRS` | 常量 | 深度上限缺省值（4）与内置跳过名单（`node_modules`、`dist`、`target`、`.git`）。 |

## 开发
```bash
pnpm --filter @veren/commander-discovery build
pnpm --filter @veren/commander-discovery test   # 19 个用例
```

```
packages/commander/discovery
├── src/
│   ├── discovery.ts   # 纯扫描与清单读取 / pure scanning + manifest readers
│   ├── deps.ts        # 子包依赖名提取 / sub-package dependency-name extraction
│   ├── service.ts     # Config schema + DiscoveryService / 配置 schema 与服务
│   ├── tokens.ts      # 平台无关的 Discovery 令牌 + UnitInventory/Unit / platform-agnostic token + views
│   └── index.ts       # 插件模块 name/inject/Config/apply 与再导出 / plugin module + re-exports
└── test/index.test.ts
```

## 注意事项与约束
- 命中单元后不再向其子目录下钻：单元即最小分发边界。
- 单个坏清单不会中断扫描 —— 向 stderr 告警并跳过，stdout 保持干净供 JSON 消费方解析。
- `list()` 每次调用重新扫描：CLI 进程生命周期短，新鲜度优先于缓存；服务随 fiber
  卸载。

## 子包依赖查询 / Sub-package dependency lookup

- `DiscoveryService.listDependencies(name)`：读取该子包自身 `package.json` 的 `dependencies`，
  返回与 `list()` 同构的 `[{ name, description, dir }]`；工作区命中的直接取清单，
  第三方依赖从子包（或项目根）`node_modules` 内的 `package.json` 读取 `name`/`description`，
  `dir` 指向 `node_modules` 内路径（元数据缺失时 description 为空兜底，该 `dir` 为
  约定路径、不保证存在）；未知名或无 `package.json` 时返回空数组。
  Reads the sub-package's own `package.json` `dependencies`, intersects by name with the
  workspace units, and returns `[{ name, description, dir }]` shaped like `list()`; an empty
  array on an unknown name or when `package.json` is absent.
- 纯函数 `parseNpmDependencyNames(manifest)` / `readUnitDependencyNames(fs, dir)`（`./deps`）
  只读 `dependencies`（不含 devDependencies 与 Cargo `[dependencies]`），供测试与自定义消费方复用。
  The pure functions read only `dependencies` (no devDependencies, no Cargo `[dependencies]`),
  reusable by tests and custom consumers.
