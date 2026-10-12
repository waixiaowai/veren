# veren-core

[中文文档](./README.cn.md)

Shared core library of the Veren Rust workspace.

## When to use

- Use it when a Rust crate in this workspace needs Veren's shared core logic.
- Do not use it for app-specific code: keep application concerns in `apps/veren`.

## Install

The crate is consumed inside the Cargo workspace, so declare it as a workspace dependency:

```toml
# apps/<name>/Cargo.toml
[dependencies]
veren-core.workspace = true
```

The path is defined once in the workspace root:

```toml
# Cargo.toml (repository root)
[workspace.dependencies]
veren-core = { path = "cargos/veren-core" }
```

## Quick start

```rust
fn main() {
    println!("{}", veren_core::greeting());
}
```

## API

| Item | Signature | Notes |
| --- | --- | --- |
| `greeting` | `fn greeting() -> &'static str` | Placeholder API returning `"Hello, world!"`. |

## Development

```bash
cargo build -p veren-core
cargo test -p veren-core     # unit tests live next to the code in src/lib.rs
cargo test --workspace       # build and test every workspace member
```

Layout:

```text
cargos/veren-core/
├── Cargo.toml
├── README.md       # this file (English)
├── README.cn.md    # Chinese
└── src/lib.rs      # library code plus #[cfg(test)] unit tests
```

## Notes & constraints

- The crate is still a skeleton: `greeting` is a placeholder, and the version/edition come from `[workspace.package]` in the root `Cargo.toml`.
- The root `Cargo.toml` declares `members = ["cargos/*", "apps/veren"]`, so any new crate placed under `cargos/` joins the workspace automatically.
- Per AGENTS.md the `[package] description` in `Cargo.toml` only states when to use this crate; usage documentation lives in this README pair.
- Code and comments are kept bilingual (Chinese + English).
