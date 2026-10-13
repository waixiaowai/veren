# veren

[English](./README.md)

`veren` 是一个面向 TypeScript 生态的“类型信息搜集器”项目：TypeScript 编译为 JavaScript
时会擦除大量类型信息，veren 借助编译流水线把这些信息在编译期搜集出来，形成可序列化的
元数据；同时提供 Rust 实现的产品入口与项目级元信息 CLI。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `cargos/` | Cargo workspace 成员（Rust 库） |
| `packages/` | pnpm workspace 成员（TypeScript 共享包） |
| `apps/` | 面向用户的产品 |
| `docs/` | 面向不同读者的手册与教程 |

Cargo 要求 workspace 根目录必须是所有 member 的祖先，因此 Rust workspace 清单在仓库根
目录；Rust 库源码仍在 `cargos/`，Rust 产品仍在 `apps/`。

## 当前成员

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `apps/cli`（`@veren/cli`） | CLI | veren CLI 外壳：组装插件清单（注册表、项目服务、list/doc/help）并分发 argv |
| `apps/veren`（`veren`） | Rust 二进制 | 面向用户的产品入口 |
| `cargos/veren-core`（`veren-core`） | Rust 库 | Veren Rust 侧共享核心逻辑 |
| `packages/core`（`@veren/core`） | TS 库 | 基于 cordis 的令牌式依赖注入基座 |
| `packages/commander/core`（`@veren/commander-core`） | TS 库 | CLI 的命令框架：`CommandDef`、注册表服务与 argv 分发器 |
| `packages/commander/project`（`@veren/commander-project`） | TS 库 | 提供 veren 项目信息服务（项目根 + `.veren.yaml` 扫描配置） |
| `packages/commander/discovery`（`@veren/commander-discovery`） | TS 库 | 按文件约定发现工作区单元（npm 包 / Rust crate） |
| `packages/commander/list`（`@veren/commander-list`） | TS 库 | CLI 的 `list` 命令插件：JSON 输出全部单元 |
| `packages/commander/doc`（`@veren/commander-doc`） | TS 库 | CLI 的 `doc` 命令插件：原样输出单元双语 README |
| `packages/commander/help`（`@veren/commander-help`） | TS 库 | CLI 的 `help` 命令插件：由注册表生成用法 |
| `packages/yaml-parser`（`@veren/yaml-parser`） | TS 库 | 提供 YAML 解析服务（CLI 读取 `.veren.yaml` 时消费） |
| `packages/compiler/compiler`（`@veren/compiler-compiler`） | TS 库 | 组装好的编译器流水线入口 |
| `packages/compiler/compiler-host`（`@veren/compiler-host`） | TS 库 | 提供 `ts.CompilerHost` 服务（含内存宿主工厂） |
| `packages/compiler/compiler-options`（`@veren/compiler-options`） | TS 库 | 提供 `ts.CompilerOptions` 服务 |
| `packages/compiler/program`（`@veren/compiler-program`） | TS 库 | 提供 `ts.Program` 服务 |
| `packages/compiler/type-checker`（`@veren/compiler-type-checker`） | TS 库 | 提供 `ts.TypeChecker` 服务 |

每个包的详细用法见其 `README.md`（英文）与 `README.cn.md`（中文），或在仓库根目录运行
`pnpm cli doc <name> [--cn]` 直接阅读。

## 常用命令

### Rust

```bash
cargo test --workspace   # 运行全部 Rust 测试
cargo run -p veren       # 运行产品入口
```

### TypeScript

```bash
pnpm install             # 安装依赖
pnpm build               # 构建全部 TS 包
pnpm test                # 运行全部 vitest 单测
```

### 项目元信息 CLI

```bash
pnpm cli list            # 列出全部单元（JSON）
pnpm cli doc @veren/core # 阅读某单元英文文档
pnpm cli doc veren-core --cn
```

单元发现由根目录的 `.veren.yaml`（`scan` 字段）驱动。

## 文档导读

- 想快速上手某个包 → 读该包的 `README.md` / `README.cn.md`
- 想系统了解（教程、面向特定读者的手册）→ 看 `docs/`
- 仓库编码与文档规范 → 见 `AGENTS.md`
