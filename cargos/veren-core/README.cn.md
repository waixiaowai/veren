# veren-core

[English](./README.md)

Veren Rust workspace 的共享核心库。

## 何时使用

- 当 workspace 内的 Rust crate 需要 Veren 的共享核心逻辑时使用。
- 不要用于应用专属代码：应用层职责留在 `apps/veren`。

## 安装

该 crate 在 Cargo workspace 内消费，因此声明为 workspace 依赖：

```toml
# apps/<name>/Cargo.toml
[dependencies]
veren-core.workspace = true
```

路径在 workspace 根清单里定义一次：

```toml
# Cargo.toml（仓库根目录）
[workspace.dependencies]
veren-core = { path = "cargos/veren-core" }
```

## 快速开始

```rust
fn main() {
    println!("{}", veren_core::greeting());
}
```

## 接口

| 项 | 签名 | 说明 |
| --- | --- | --- |
| `greeting` | `fn greeting() -> &'static str` | 占位接口，返回 `"Hello, world!"`。 |

## 开发

```bash
cargo build -p veren-core
cargo test -p veren-core     # 单元测试与代码同处 src/lib.rs
cargo test --workspace       # 构建并测试全部 workspace 成员
```

目录结构：

```text
cargos/veren-core/
├── Cargo.toml
├── README.md       # 英文文档
├── README.cn.md    # 本文件（中文）
└── src/lib.rs      # 库代码与 #[cfg(test)] 单元测试
```

## 注意事项与约束

- 该 crate 目前仍是骨架：`greeting` 为占位实现，版本与 edition 来自根 `Cargo.toml` 的 `[workspace.package]`。
- 根 `Cargo.toml` 声明 `members = ["cargos/*", "apps/veren"]`，因此放在 `cargos/` 下的新 crate 会自动成为 workspace 成员。
- 按 AGENTS.md 约定，`Cargo.toml` 的 `[package] description` 只写「何时使用这个 crate」；用法文档即本 README 双语文件。
- 代码与注释保持中英文双语。
