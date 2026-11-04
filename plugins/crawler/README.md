# @veren/crawler

Multi-platform content crawler for DSH — collects public contents and comments from mainstream Chinese content communities (Xiaohongshu, Douyin, Kuaishou, Bilibili, Weibo, Tieba, Zhihu) for study and research; every person identifier is anonymized before persistence, and shaped records land in the **host storage domain** (dsh storageDomain, the plugin's only storage medium).

## When to use

- You need structured public content data (keyword search / content detail / creator home) at a controlled frequency.
- You want heterogeneous platform payloads shaped into one unified entity model with mandatory anonymization (hashed creator ids, masked nicknames).
- Skip it if your deployment never bulk-collects social content.

## Architecture (integration shape)

- **Storage is the host storageDomain only**: records upsert by business key into the `crawler` domain (contents/comments tables), idempotent across reruns; file and database media belong to other dsh plugins (user directive).
- **Crawls run in-process** (the storage domain requires it) with cooperative cancellation; the control api rides the host web server (`ctx.webServer.register`, no standalone port).
- **Browser CDP attach first** (real fingerprint and login session preserved), falling back to a standard persistent launch of the system Chrome.
- **Login-first invariant**: probe → login → persist; no business request before a passing probe.

## Implemented

- Platform crawlers: **wb** (live-verified: dual-site cookie login, search/detail/creator, companion comments, long-post completion), **tieba** (live-verified: login-free json channel, 15+ real rows persisted), **bili** (pure-algorithm WBI signing, code+tests done, cookie warm-up being debugged)
- Login and credentials: the three-segment flow (probe → login → persist) + the login-session state machine; cookie injection is re-verified
- Storage adapter: shaping with mandatory anonymization (SHA-256 hash + nickname masking) → the host storage domain
- Engine: concurrency semaphore, rate-limit backoff, the unified pagination loop (count cap, empty-page stop, single-item isolation, cooperative cancel)
- Control service: task manager (single-task mutex, stop with timeout force-kill), log ring buffer, the `/api/data/domain` read face, **ws-logs/ws-status** push channels (host `registerUpgrade` + a minimal RFC6455 server)
- Tools and skill: `crawler__start/stop/status/logs/data` + the bundled `crawler` skill (usage guidance)
- Client entry: the `crawler` app (`/apps/crawler/overview`)
- Wordcloud: the frequency-table data source (chinese bigrams / latin tokens + stopwords; rendering belongs to external tools)

## Install

Via [`../crawler-bundle/`](../crawler-bundle) (a configuration-only bundle); the skill row is separate, so a profile without `skills` only leaves that row pending.

## Development

```bash
pnpm --filter @veren/crawler test       # unit tests (vitest)
pnpm --filter @veren/crawler typecheck  # tsc --noEmit
pnpm --filter @veren/crawler build      # emit dist/
```

## Documentation

- 中文文档：[README.cn.md](./README.cn.md)
- 设计方案：`design/` (architecture, module contracts, api, permissions, states, data dictionary, acceptance)
- Implementation decisions: `design/implementation-decisions.md`
