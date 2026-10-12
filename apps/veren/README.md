# veren

[中文文档](./README.cn.md)

User-facing command-line application of the Veren workspace.

## When to use

- Use it when you want to run or ship the Veren CLI product itself.
- Depend on the library crates (for example `veren-core`) instead when you only need reusable logic.

## Install

The application is built from source inside this Cargo workspace; it is not published to a registry.

```bash
cargo build -p veren          # debug binary in target/debug/veren
cargo build -p veren --release
```

## Quick start

```bash
cargo run -p veren
# Hello, world!
```

## Behaviour

| Command | Output |
| --- | --- |
| `cargo run -p veren` | Prints the greeting returned by `veren_core::greeting()`. |

The binary exposes no library API; reusable code lives in the workspace crates under `cargos/`.

## Development

```bash
cargo run -p veren        # run this binary
cargo check -p veren      # type-check without producing a binary
cargo test --workspace    # build and test every workspace member
```

Layout:

```text
apps/veren/
├── Cargo.toml
├── README.md       # this file (English)
├── README.cn.md    # Chinese
└── src/main.rs     # CLI entry point
```

## Notes & constraints

- The root `Cargo.toml` sets `default-members = ["apps/veren"]`, so a plain `cargo run` from the repository root runs this binary.
- Version and edition come from `[workspace.package]` in the root `Cargo.toml` (currently edition 2024).
- Per AGENTS.md the `[package] description` in `Cargo.toml` only states when to use this crate; usage documentation lives in this README pair.
- Code and comments are kept bilingual (Chinese + English).
