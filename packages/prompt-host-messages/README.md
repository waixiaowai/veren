# Prompt Host Messages

English | [中文](./README.cn.md)

## What & When to Use

The message-log host renderer for `@veren/prompt-core` — the `react-dom` of this architecture. It commits fiber effects (placement/update/deletion) into an append-only `SNAPSHOT`/`PATCH` message stream with versioned sync. Use it between page components and an LLM chat API. Provider-specific cache-boundary policies belong here (not yet implemented); the kernel stays provider-agnostic.

## Semantics (the LLM-specific policy layer)

- **append (placement)**: structured op staged; `flush()` batches and bumps the version.
- **revise (update)**: history is physically immutable → restated with the new value (splice/set ops are idempotent restatements).
- **evict (deletion)**: `splice` without `entity` / `remove` op; mirrored collection state drops the entry.
- **renderSince(cursor)**: delta-first; missing baseline / gap too large / future cursor → full snapshot from mirrored state.
- **anchor (compaction)**: patch chain beyond `compactEvery` → drop the chain; stale cursors fall back to snapshots.

## Wire Format (byte-stable templates)

```
SNAPSHOT vN {"nodes":[{"content":"...","kind":"static"},{"items":[...],"kind":"keyed","path":"tasks"}]}
PATCH vA->vB {"ops":[{"entity":{...},"id":"t-1","op":"splice","path":"tasks"}]}
```

## Run

```bash
pnpm --filter @veren/prompt-host-messages test
```
