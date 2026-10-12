# veren

Rust + TypeScript 混合仓库 / Hybrid Rust + TypeScript repository.

`veren` 是一个面向 TypeScript 生态的"类型信息搜集器"项目：TypeScript 编译为 JavaScript
时会擦除大量类型信息，veren 借助编译流水线把这些信息在编译期搜集出来，形成可序列化的
元数据；同时提供 Rust 实现的产品入口与项目级元信息 CLI。

`veren` is a "type information collector" for the TypeScript ecosystem: compiling TS to JS
erases most type information, and veren collects it at compile time through a compiler
pipeline into serializable metadata. A Rust product binary and a project-level metadata
CLI round out the workspace.

## 仓库结构 / Repository layout

| 目录 | 内容 / Contents |
| --- | --- |
| `cargos/` | Cargo workspace 成员（Rust 库）/ Cargo workspace members (Rust libraries) |
| `packages/` | pnpm workspace 成员（TypeScript 共享包）/ pnpm workspace members (shared TypeScript packages) |
| `apps/` | 面向用户的产品 / user-facing products |
| `scripts/` | 开发辅助脚本 / development helper scripts |
| `docs/` | 面向不同读者的手册与教程 / manuals and tutorials for different audiences |

Cargo 要求 workspace 根目录必须是所有 member 的祖先，因此 Rust workspace 清单在仓库根
目录；Rust 库源码仍在 `cargos/`，Rust 产品仍在 `apps/`。

Cargo requires the workspace root to be an ancestor of every member, so the Rust
workspace manifest lives at the repository root; Rust library sources stay in `cargos/`
and the Rust product stays in `apps/`.

## 当前成员 / Current members

| 成员 / Member | 类型 / Kind | 说明 / Purpose |
| --- | --- | --- |
| `apps/cli`（`@veren/cli`） | CLI | 项目级元信息 CLI：列出工作区单元、读取双语文档 / project-level metadata CLI: list workspace units, read bilingual docs |
| `apps/veren`（`veren`） | Rust 二进制 / Rust binary | 面向用户的产品入口 / the user-facing product entry |
| `cargos/veren-core`（`veren-core`） | Rust 库 / Rust library | Veren Rust 侧共享核心逻辑 / shared core logic on the Rust side |
| `packages/core`（`@veren/core`） | TS 库 / TS library | 基于 cordis 的令牌式依赖注入基座 / token-based dependency-injection foundation on top of cordis |
| `packages/compiler/compiler`（`@veren/compiler-compiler`） | TS 库 / TS library | 组装好的编译器流水线入口 / the assembled compiler pipeline entry |
| `packages/compiler/compiler-host`（`@veren/compiler-host`） | TS 库 / TS library | 提供 ts.CompilerHost 服务（含内存宿主工厂）/ provides the ts.CompilerHost service (with an in-memory host factory) |
| `packages/compiler/compiler-options`（`@veren/compiler-options`） | TS 库 / TS library | 提供 ts.CompilerOptions 服务 / provides the ts.CompilerOptions service |
| `packages/compiler/program`（`@veren/compiler-program`） | TS 库 / TS library | 提供 ts.Program 服务 / provides the ts.Program service |
| `packages/compiler/type-checker`（`@veren/compiler-type-checker`） | TS 库 / TS library | 提供 ts.TypeChecker 服务 / provides the ts.TypeChecker service |

每个包的详细用法见其 `README.md`（英文）与 `README.cn.md`（中文），或在仓库根目录运行
`pnpm cli doc <name> [--cn]` 直接阅读。

Each package documents itself in `README.md` (English) and `README.cn.md` (Chinese);
you can also run `pnpm cli doc <name> [--cn]` from the repository root to read them.

## 常用命令 / Common commands

### Rust

```bash
cargo test --workspace   # 运行全部 Rust 测试 / run every Rust test
cargo run -p veren       # 运行产品入口 / run the product binary
```

### TypeScript

```bash
pnpm install             # 安装依赖 / install dependencies
pnpm build               # 构建全部 TS 包 / build every TS package
pnpm test                # 运行全部 vitest 单测 / run every vitest unit test
```

### 项目元信息 CLI / Project metadata CLI

```bash
pnpm cli list            # 列出全部单元（JSON）/ list all units as JSON
pnpm cli doc @veren/core # 阅读某单元英文文档 / read a unit's English docs
pnpm cli doc veren-core --cn
```

单元发现由根目录的 `.veren.yaml`（`scan` 字段）驱动 / unit discovery is driven by the
`scan` field of the root `.veren.yaml`.

## 文档导读 / Documentation guide

- 想快速上手某个包 → 读该包的 `README.md` / `README.cn.md`
  To get started with one package → read that package's README pair.
- 想系统了解（教程、面向特定读者的手册）→ 看 `docs/`
  For systematic material (tutorials, audience-specific manuals) → see `docs/`.
- 仓库编码与文档规范 → 见 `AGENTS.md`
  Coding and documentation conventions → see `AGENTS.md`.
