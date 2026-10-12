# veren

[English](./README.md)

Veren workspace 面向用户的命令行产品。

## 何时使用

- 需要运行或分发 Veren CLI 产品本身时使用。
- 只需要可复用逻辑时，请依赖库 crate（例如 `veren-core`）。

## 安装

该应用在 Cargo workspace 内从源码构建，不发布到 registry。

```bash
cargo build -p veren          # 调试产物位于 target/debug/veren
cargo build -p veren --release
```

## 快速开始

```bash
cargo run -p veren
# Hello, world!
```

## 行为

| 命令 | 输出 |
| --- | --- |
| `cargo run -p veren` | 打印 `veren_core::greeting()` 返回的问候语。 |

该二进制不对外暴露库接口；可复用代码位于 `cargos/` 下的 workspace crate。

## 开发

```bash
cargo run -p veren        # 运行本二进制
cargo check -p veren      # 仅类型检查，不产出二进制
cargo test --workspace    # 构建并测试全部 workspace 成员
```

目录结构：

```text
apps/veren/
├── Cargo.toml
├── README.md       # 英文文档
├── README.cn.md    # 本文件（中文）
└── src/main.rs     # 命令行入口
```

## 注意事项与约束

- 根 `Cargo.toml` 设置 `default-members = ["apps/veren"]`，因此在仓库根目录直接执行 `cargo run` 就会运行本二进制。
- 版本与 edition 来自根 `Cargo.toml` 的 `[workspace.package]`（当前 edition 为 2024）。
- 按 AGENTS.md 约定，`Cargo.toml` 的 `[package] description` 只写「何时使用这个 crate」；用法文档即本 README 双语文件。
- 代码与注释保持中英文双语。
