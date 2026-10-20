# Page-Sync Bench

English | [中文](./README.cn.md)

## What & When to Use

A DSH plugin + real-API benchmark validating append-only delta sync for page-sessions. Use it when you need hard numbers on prompt-cache hit rate, tool-call success rate, and token cost for the "page = session" design (static system prompt + tools, dynamic state injected as snapshots/patches). Not for production use — port the protocol (`store.ts` + `protocol.ts`) into real packages instead.

## Design Under Test

- **Kernel**: the page is a memoized function component (`TaskListPage`); store changes flow `bindStore → prompt-core reconciler → MessageHost` and commit into an append-only `SNAPSHOT`/`PATCH` stream.
- **Page = session**: static system prompt + static tool schemas form the cacheable prefix.
- **Server-side authority**: `TaskStore` owns the task list; the model keeps only a mental copy.
- **Two context modes compared**:
  - `full` — every round appends a full `SNAPSHOT` (the naive baseline)
  - `delta` — first round appends a snapshot, later rounds append `PATCH vA->vB {ops}`
- **Tools = buttons**: `take_task` / `complete_task` validate status transitions and fail loud with stable codes.
- **Verification**: every directive is checked against server state (did the model actually take/complete the right tasks).

## Running

```bash
pnpm test        # unit tests (no network)
pnpm test:e2e    # real DeepSeek API, two arms × 6 rounds; skips without credentials
```

Credentials: `DEEPSEEK_API_KEY` env var, or `~/.dsh/.credentials.yaml` `refs.DEEPSEEK_API_KEY`. Reports are written to `bench/report-full.json` and `bench/report-delta.json`.

## Key Statistics Reported

- Per round: prompt tokens, cache-hit tokens, hit rate, injected bytes, tool success, directive success
- Totals: prompt/completion tokens, aggregate cache hit rate, tool success rate, directives completed
