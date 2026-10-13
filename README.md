# veren

[中文文档](./README.cn.md)

`veren` is a "type information collector" for the TypeScript ecosystem: compiling TS to JS
erases most type information, and veren collects it at compile time through a compiler
pipeline into serializable metadata. A Rust product binary and a project-level metadata
CLI round out the workspace.

## Repository layout

| Directory | Contents |
| --- | --- |
| `cargos/` | Cargo workspace members (Rust libraries) |
| `packages/` | pnpm workspace members (shared TypeScript packages) |
| `apps/` | user-facing products |
| `docs/` | manuals and tutorials for different audiences |

Cargo requires the workspace root to be an ancestor of every member, so the Rust
workspace manifest lives at the repository root; Rust library sources stay in `cargos/`
and the Rust product stays in `apps/`.

## Current members

| Member | Kind | Purpose |
| --- | --- | --- |
| `apps/cli` (`@veren/cli`) | CLI | the veren CLI shell: assembles the plugin manifest (registry, project, list/doc/help) and dispatches argv |
| `apps/veren` (`veren`) | Rust binary | the user-facing product entry |
| `cargos/veren-core` (`veren-core`) | Rust library | shared core logic on the Rust side |
| `packages/core` (`@veren/core`) | TS library | token-based dependency-injection foundation on top of cordis |
| `packages/commander/core` (`@veren/commander-core`) | TS library | the CLI's command framework: `CommandDef`, the registry service and the argv dispatcher |
| `packages/commander/project` (`@veren/commander-project`) | TS library | provides the veren project info service (root + `.veren.yaml` scan config) |
| `packages/commander/discovery` (`@veren/commander-discovery`) | TS library | discovers workspace units (npm packages / Rust crates) by file convention |
| `packages/commander/list` (`@veren/commander-list`) | TS library | the CLI's `list` command as a Cordis plugin: prints every unit as JSON |
| `packages/commander/doc` (`@veren/commander-doc`) | TS library | the CLI's `doc` command as a Cordis plugin: prints a unit's bilingual README |
| `packages/commander/help` (`@veren/commander-help`) | TS library | the CLI's `help` command as a Cordis plugin: usage generated from the registry |
| `packages/yaml-parser` (`@veren/yaml-parser`) | TS library | provides the YAML parsing service (consumed by the CLI for `.veren.yaml`) |
| `packages/compiler/compiler` (`@veren/compiler-compiler`) | TS library | the assembled compiler pipeline entry |
| `packages/compiler/compiler-host` (`@veren/compiler-host`) | TS library | provides the `ts.CompilerHost` service (with an in-memory host factory) |
| `packages/compiler/compiler-options` (`@veren/compiler-options`) | TS library | provides the `ts.CompilerOptions` service |
| `packages/compiler/program` (`@veren/compiler-program`) | TS library | provides the `ts.Program` service |
| `packages/compiler/type-checker` (`@veren/compiler-type-checker`) | TS library | provides the `ts.TypeChecker` service |

Each package documents itself in `README.md` (English) and `README.cn.md` (Chinese);
you can also run `pnpm cli doc <name> [--cn]` from the repository root to read them.

## Common commands

### Rust

```bash
cargo test --workspace   # run every Rust test
cargo run -p veren       # run the product binary
```

### TypeScript

```bash
pnpm install             # install dependencies
pnpm build               # build every TS package
pnpm test                # run every vitest unit test
```

### Project metadata CLI

```bash
pnpm cli list            # list all units as JSON
pnpm cli doc @veren/core # read a unit's English docs
pnpm cli doc veren-core --cn
```

Unit discovery is driven by the `scan` field of the root `.veren.yaml`.

## Documentation guide

- To get started with one package → read that package's README pair.
- For systematic material (tutorials, audience-specific manuals) → see `docs/`.
- Coding and documentation conventions → see `AGENTS.md`.
