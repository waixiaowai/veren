# Prompt Host Messages

English | [中文](./README.cn.md)

## What & When to Use

The message-log host renderer for `@veren/prompt-core` — the `react-dom` of this architecture. It commits fiber effects (placement/update/deletion) into an append-only `SNAPSHOT`/`PATCH` message stream with versioned sync. Use it between page components and an LLM chat API. Provider-specific cache-boundary policies live here (`cache.ts` + `compact.ts`); the kernel stays provider-agnostic.

## Provider Policies (wired via `createSyncAssembler`)

- **Cache breakpoints** — `planMessages(policy, systemPrompt, syncs)` assembles the context blocks and places breakpoints per provider: explicit `ephemeral` on the tail sync for `anthropic` (≤4); none for `deepseek`/`openai` (automatic prefix caching). `policyFor(provider)` maps a provider name to its policy. **Default for unknown providers (explicit, not silent): deepseek semantics** — automatic prefix caching, zero explicit markers; register a policy here before relying on breakpoints.
- **Budget compaction** — `tokenBudgetPolicy` watches `host.logStats()` (entries / approx-tokens thresholds, defaults 200 ops / 200k tokens); `remount(host)` anchors and emits the fresh snapshot baseline (one cache miss buys a clean prefix). `createSyncAssembler({ host, policy, systemPrompt?, budget? })` bundles both: each `assemble()` advances the cursor internally, remounts on budget, and returns `{ remounted, empty, blocks, chat, text }`.
- Wiring points in this repo: `@veren/prompt-page` `mountPage({ assembly })` → `session.assemble()`, and the page-sync-bench pre-step injection. On the DSH-hosted chain the platform LLM layer owns the final request's cache control; the assembler's block face is for standalone runtimes that build requests themselves.

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
