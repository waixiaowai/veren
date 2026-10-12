# @veren/cli

[English](./README.md)

veren 工作区的项目级元信息 CLI：发现工作区内的全部单元（npm 包或 Rust crate），把它们的
名称、描述与双语文档以命令行方式交给 AI 代理和开发者。

## 何时使用

- 你（或 AI 代理）需要工作区单元清单 —— `{ name, description, dir }` —— 而不想手工维护列表。
- 你想在脚本或代理循环中原样读取某个单元的文档，并用参数选择中文或英文。
- 你在外部工具链中需要根据单元名定位其目录。

如果需要的是构建/测试编排，请直接使用 `pnpm build` / `pnpm test` 或 `cargo`，不要用本 CLI。

## 用法

在仓库内任意位置通过根 `cli` 脚本运行：

```bash
pnpm cli list                # 全部单元（JSON）/ all units as JSON
pnpm cli doc <name>          # 原文输出 README.md / print README.md verbatim
pnpm cli doc <name> --cn     # 原文输出 README.cn.md / print README.cn.md verbatim
pnpm cli help                # 双语用法说明 / bilingual usage text
```

`list` 独占 stdout：除 JSON 数组 `[{ name, description, dir }, ...]` 外不输出任何内容，
按 `dir` 排序，方便代理直接解析。`doc` 原样输出 README —— 不加任何修饰 —— 首选语言文件
缺失时回退另一语言。错误信息为双语，走 stderr，退出码非 0。

## 配置

项目根目录的 `.veren.yaml` 驱动单元发现：

```yaml
scan:            # 扫描根目录（相对本文件）/ scan roots, relative to this file
  - apps
  - packages
  - cargos
```

CLI 从当前目录逐级向上查找 `.veren.yaml`，其所在目录即项目根。每个扫描根递归扫描，
深度上限 4 层；`node_modules`、`dist`、`target` 与隐藏目录被跳过。目录内含
`package.json` 视为 npm 单元，含 `Cargo.toml` 视为 Rust 单元；两者并存时以 `package.json`
为准。命中单元后不再向其子目录下钻 —— 单元即最小分发边界。

## 设计说明

- `dir` 始终是相对项目根、以 `/` 分隔的路径，保证跨平台输出稳定。
- Cargo.toml 字段由一个零依赖的小型提取器解析，只支持本仓库用到的 `name`/`description`
  基础字符串写法（支持转义与行尾注释）—— 不引入 TOML 依赖。
- CLI 通过 Node 原生类型擦除直接运行 TS 源码，因此相对导入使用显式 `.ts` 扩展名
  （`allowImportingTsExtensions`）。

## 开发

```bash
pnpm --filter @veren/cli build   # 仅类型检查（noEmit）/ type-check only
pnpm --filter @veren/cli test    # vitest 单测 / vitest unit tests
```

```
apps/cli
├── README.md              # 英文文档
├── README.cn.md           # 中文文档
├── package.json
├── src/
│   ├── cli.ts             # 入口：命令分发与错误出口 / entry: command dispatch + error exit
│   ├── config.ts          # 项目根定位与配置加载 / project root discovery + config loading
│   └── discovery.ts       # 单元发现：npm / Rust 约定 / unit scanning conventions
└── test/
    ├── config.test.ts     # 6 个用例
    └── discovery.test.ts  # 9 个用例
```

测试基于临时目录树，覆盖配置加载与单元发现逻辑（Cargo 字段提取、npm/Rust 单元读取、
深度上限、跳过名单、npm 优先于 Rust）。
