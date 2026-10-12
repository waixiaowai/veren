# @veren/cli

[中文文档](./README.cn.md)

Project-level metadata CLI for the veren workspace: it discovers every unit (npm package or Rust crate) and hands their names, descriptions and bilingual READMEs to AI agents and developers on the command line.

## When to use

- You (or an AI agent) need an inventory of the workspace's units — `{ name, description, dir }` — without hand-maintaining a list.
- You want to read a unit's documentation verbatim from a script or agent loop, choosing English or Chinese with a flag.
- You are wiring tooling that must locate a unit's directory from outside the repo tooling.

Skip it when you need build/test orchestration — use `pnpm build` / `pnpm test` or `cargo` directly instead.

## Usage

Run from anywhere inside the repository through the root `cli` script:

```bash
pnpm cli list                # all units as JSON / 全部单元（JSON）
pnpm cli doc <name>          # print README.md verbatim / 原文输出 README.md
pnpm cli doc <name> --cn     # print README.cn.md verbatim / 原文输出 README.cn.md
pnpm cli help                # bilingual usage text / 双语用法说明
```

`list` owns stdout exclusively: it prints nothing but the JSON array `[{ name, description, dir }, ...]`, sorted by `dir`, so agents can parse it trivially. `doc` prints the README verbatim — no decorations — with the other language as fallback when the preferred file is missing. Errors go to stderr with a non-zero exit code and bilingual messages.

## Configuration

`.veren.yaml` at the project root drives unit discovery:

```yaml
scan:            # scan roots, relative to this file / 扫描根目录（相对本文件）
  - apps
  - packages
  - cargos
```

The CLI walks up from the working directory until it finds `.veren.yaml`; that directory is the project root. Each scan root is scanned recursively with a depth cap of 4; `node_modules`, `dist`, `target` and hidden directories are skipped. A directory containing `package.json` is an npm unit, one containing `Cargo.toml` a Rust unit; if both exist, `package.json` wins. Once a unit is matched the scan does not descend into it — a unit is the smallest distributable boundary.

## Design notes

- `dir` is always a root-relative path with forward slashes, so output stays stable across platforms.
- Cargo.toml fields are parsed by a small dependency-free extractor that supports the plain `name`/`description` string style used in this repo (escapes and trailing comments included) — no TOML dependency.
- The CLI runs from TypeScript source through Node's native type stripping; relative imports therefore use explicit `.ts` extensions (`allowImportingTsExtensions`).

## Development

```bash
pnpm --filter @veren/cli build   # type-check only (noEmit) / 仅类型检查
pnpm --filter @veren/cli test    # vitest unit tests / vitest 单测
```

```
apps/cli
├── README.md              # English docs
├── README.cn.md           # Chinese docs
├── package.json
├── src/
│   ├── cli.ts             # entry: command dispatch + error exit / 入口：命令分发与错误出口
│   ├── config.ts          # project root discovery + .veren.yaml loading / 项目根定位与配置加载
│   └── discovery.ts       # unit scanning: npm / Rust conventions / 单元发现：npm / Rust 约定
└── test/
    ├── config.test.ts     # 6 cases
    └── discovery.test.ts  # 9 cases
```

Tests cover the config loader and the discovery logic (Cargo field extraction, npm/Rust unit reading, depth cap, skip list, npm-over-Rust precedence) against temporary directory trees.
