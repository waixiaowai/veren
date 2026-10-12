# veren

Rust + TypeScript 仓库。

| 目录 | 内容 |
| --- | --- |
| `cargos/` | Cargo workspace（Rust crate） |
| `packages/` | TypeScript workspace（共享包） |
| `apps/` | 面向用户的产品 |

当前成员：

- `cargos/veren-core`：Rust 库
- `packages/shared`（`@veren/shared`）：TypeScript 库
- `apps/veren`：Rust 二进制产品

Cargo 要求 workspace 根目录必须是所有 member 的祖先，因此 workspace 清单在仓库根目录；Rust 库源码仍在 `cargos/`，Rust 产品仍在 `apps/`。

## Rust

```bash
cargo test --workspace
cargo run -p veren
```

## TypeScript

```bash
pnpm install
pnpm build
pnpm test
```
