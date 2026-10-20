# Page-Sync Core

English | [中文](./README.cn.md)

## What & When to Use

Generic virtual-prompt-tree sync kernel for LLM page-sessions — the React reconciliation model applied to append-only model context: `render(template, state) → tree → diff → ops → byte-stable message → append`. Use it when a plugin needs cache-friendly incremental context updates (list pages, detail pages, event feeds). Do not put business logic here; domain plugins own their state and buttons and consume this kernel.

## Concepts

- **PromptNode kinds**: `static` (never diffed, memoized) / `field` (set op) / `keyed` (key diff → splice) / `log` (append-only) / `group` (recursive, reference-equality bail-out).
- **Ops**: `set` / `remove` / `splice` / `append` — three semantics cover every page archetype.
- **PageStore**: `update()` (diff+commit, batched), `stage()`/`flush()` (background lane), `sync(cursor)` (delta-first, snapshot fallback on gap/no-baseline), `anchor()` (compaction).
- **Byte stability**: `canonicalJson` sorts object keys; message envelopes (`PATCH vA->vB {ops}` / `SNAPSHOT vN {nodes}`) are fixed templates, so unchanged template bytes stay cache-hit.

## Immutability Discipline (important)

`diffNodes` bails out on reference equality (React memo semantics). Mutating an array/object that a previous tree still references makes the diff see "no change" and emit zero ops. Always pass a fresh copy of changed data to `PageStore.update()` — treat every tree you hand to the kernel as an immutable snapshot.

## Run

```bash
pnpm --filter @veren/page-sync-core test
```

First consumer: `plugins/page-sync-bench` (real-API validation of cache hit rate, tool success, token cost).
