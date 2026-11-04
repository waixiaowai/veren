# @veren/crawler

Multi-platform content crawler for DSH — collects public contents and comments from mainstream Chinese content communities (Xiaohongshu, Douyin, Kuaishou, Bilibili, Weibo, Tieba, Zhihu) for study and research, anonymizes every person identifier before persistence, and stores shaped records into the configured medium.

## When to use

- You need structured public content data (keyword search / content detail / creator home) at a controlled frequency.
- You want heterogeneous platform payloads shaped into one unified entity model with mandatory anonymization (hashed creator ids, masked nicknames).
- Skip it if your deployment never bulk-collects social content.

## Current status (iteration 1)

Implemented per `design/` (see `design/index.md` for the full plan):

- Shared contracts: platforms, modes, save options, command args, unified records (`src/types.ts`).
- Global error codes as structured errors with stable codes (`src/errors.ts`, `design/errors.md`).
- Crawler task state machine with explicit illegal transitions (`src/task/state.ts`, `design/states.md`).
- Launch argument parsing and validation: mode-specific required fields, cookie credentials, positive-int guards (`src/launcher/args.ts`).
- Crawler contract and the platform-registry factory: unknown platforms fail before any crawl (`src/crawler/`).
- Login and credentials: the three-segment flow (probe → login → persist) plus the login-session state machine; cookie injection is re-verified and credentials never reach data media (`src/auth/`).
- Control-service core: the task manager (single-task mutex, stop with timeout force-kill), the 500-entry log ring buffer, and data-file listing/preview with path-escape protection (`src/control/`).
- Control-service api: route families mounted on the **host web server** (`ctx.webServer.register` prefix registration, **no standalone port**), covering start/stop/status/logs/data/config/health endpoints with reverse-order dispose (`src/control/http-server.ts`, depends on `@deepseek-ai/dsh-host-webserver`); the ws push channels land in a later iteration.
- Process model and entry integration: the node child-process runner (environment scrubbing, log pump, terminate/kill), the CLI entry (single-JSON-argument process contract), plugin apply wiring the task manager and control server with reverse-order dispose (`src/runner/`, `src/cli.ts`, `src/index.ts`).
- Platform-agnostic crawl engine core: the concurrency semaphore, rate-limit classification with exponential backoff, and the unified pagination loop (count cap, empty-page stop, fixed inter-page interval, single-item failure isolation) (`src/crawler/semaphore.ts`, `ratelimit.ts`, `engine.ts`).
- Cache (peripheral): the expiring key-value abstraction with a memory backend (instant expiry checks plus a periodic sweep) and a factory that rejects unknown types (`src/cache/`).
- Proxy pool (peripheral): random draw / reload on empty / three fetch retries, single-active expiry switching (30s buffer), the pre-request refresh hook (off-switch passthrough, keep-the-old-proxy on failure), and dual format conversion (`src/proxy/`).
- Media downloader (peripheral): serial persistence, the candidate chain, .part resumable downloads, zero-byte verification, filename sanitization / reserved names / length truncation / escape protection, the extension whitelist and inference priority, and the DASH merge seam (`src/media/`).
- Browser automation layer: **CDP attach first** (real fingerprint and login session preserved, standard persistent launch as the fallback), cookie-string injection/read-back conversion, and an injectable playwright-core structural surface for tests (`src/browser/`).
- Platform-crawler skeleton and the first platform: the `BaseCrawler` unified main flow (launch → probe/login → crawl → cleanup, credentials before requests) and the `WbCrawler` weibo implementation (no encrypted signature, search/detail/creator modes, long-post completion, m.weibo.cn parsing) (`src/crawler/base.ts`, `src/platform/wb/`).
- The full pipeline: start request → platform crawler → store sink (shape/mask) → medium persistence → finalize, with every dependency injectable; the CLI entry wires real browser sessions and host fetch (`src/pipeline.ts`, `src/sink.ts`).
- Companion comments and in-session fetching: weibo comment cursor pagination (comments/hotflow, count cap) and context-scoped api requests that carry the login session automatically (`src/platform/wb/comments.ts`, `src/browser/context-fetch.ts`).
- Storage adapts the host storageDomain (directive 2): a ninth `dsh` medium (the host-integration extension) — unified records upserted by business key into the host `crawler` domain (contents/comments tables), idempotent across reruns; the `dsh` medium runs in-process (the in-process runner with cooperative cancellation) while file media keep the subprocess CLI (`src/store/domain.ts`, `dsh-store.ts`, `src/runner/inprocess-runner.ts`).
- Model tool face (directive 4): `crawler__start/stop/status/logs/data` — five tools via `ctx.tools.register` with canonical `kind:'error'` values, letting the model start/stop crawls, read status, tail logs, and summarize storage-domain data (`src/tools.ts`).
- Skill guidance (directive 4): `../crawler-skill/` — the bundled `crawler` skill covering when to collect, the five tools, the single-task mutex, the save media, the login requirement, failure handling, and the compliance red line; its own row, so a profile without `skills` only leaves it pending and never takes down the crawler row.
- Client entry (directive 5): the `crawler` app (`/apps/crawler/overview`) — the task-status snapshot, storage-domain data volume, and the page session mounting the five tools; `ctx.apps.register` + pages wired in one effect that rolls back finished steps in reverse on failure (`src/app.ts`, `src/page-overview.tsx`).
- The bundle: `../crawler-bundle/` (configuration-only, inserts the single `crawler` row, the member rides as a plain dependency) — the install entry.
- Storage adapter: anonymization (`store/mask.ts`), shaping (`store/shape.ts`), file media json/jsonl/csv (`store/`), media factory.
- Plugin entry with schemastery config (`src/config.ts`).

Planned next iterations (per design docs, not yet built): browser automation layer, platform crawlers, login/credential module, media downloader, proxy pool, cache, wordcloud, HTTP control service, client panel pages.

## Development

```bash
pnpm --filter @veren/crawler test       # unit tests (vitest)
pnpm --filter @veren/crawler typecheck  # tsc --noEmit
pnpm --filter @veren/crawler build      # emit dist/
```

## Documentation

- 中文文档：[README.cn.md](./README.cn.md)
- 设计方案：`plugins/crawler/design/`（中文，覆盖架构、模块契约、接口、权限、状态、数据字典、验收）
