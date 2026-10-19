# @veren/admin-audit-default

The default `audit` capability provider for the DSH admin platform. It keeps the
append-only governance trail in the `admin_audit` collection through the shared
`data` port and exposes it as one authenticated list endpoint.

## What it provides

- An implementation of `AdminAudit` from `@veren/admin-contract`, registered
  through `ctx.admin.register(manifest, implementation)` behind the
  `ctx.adminAudit` façade.
- `record(entry)`: appends one entry with a generated UUID and an ISO-8601 UTC
  timestamp, then enforces the entry cap and the retention window.
- `list(query)`: filter, newest-first ordering, cursor paging.
- `health()`: probes the data collection and reports `ok` or `down`.
- `GET /api/admin/v1/audit`: a thin HTTP projection of `list`.

Both the capability registration and the route registration live in
`ctx.effect(...)`, so unloading the plugin removes the capability and the route
together. Providers register the manifest, never a concrete consumer contract:
replacing this package with another audit provider does not change callers.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxEntries` | `100000` | Maximum retained entries. The oldest entries are removed first. Must be a positive integer. |
| `retentionDays` | `180` | Retention window in days. Entries older than `now - retentionDays` are removed. Must be a positive integer. |

Both fields are optional; the provider applies the defaults itself so direct
embedders and tests get the same behavior as the loader. Invalid values fail
loudly with `AdminError('VALIDATION_FAILED', ...)`.

```ts
// profile row
plugins:
  - id: admin-audit-default
    config:
      maxEntries: 50000
      retentionDays: 90
```

## Route

| Method | Path | Permission | Tags |
|---|---|---|---|
| `GET` | `/api/admin/v1/audit` | `admin.audit.read` | `audit` |

The registered route path is audience-relative (`/audit`); the table above shows
the gateway-derived public path.

Query parameters, validated by the route's declared `query` schema:

| Parameter | Meaning |
|---|---|
| `limit` | Page size, default 50, values above 200 are clamped. |
| `cursor` | Opaque cursor from the previous page's `nextCursor`. |
| `actorId` | Exact acting user id. |
| `action` | Action name prefix, for example `auth.`. |
| `result` | One of `intent`, `success`, `failure`, `denied`. |
| `since` | Inclusive lower time bound, ISO-8601. |
| `until` | Inclusive upper time bound, ISO-8601. |

Response: `{ items, nextCursor? }`, where `items` is newest first.

Ordering is by `at` descending, then `id` descending for a deterministic tie.
Cursors encode the numeric offset in base64; they are opaque to clients and the
encoding may change. A malformed cursor, limit, `since` or `until` raises
`VALIDATION_FAILED`.

## Retention invariant

Trimming walks the collection oldest first. The entry cap consumes a prefix of
that order and the retention cutoff is a time boundary, so a newer entry is
never dropped while an older one survives. Removal is sequential: a partially
completed trim is still a correct trim.

## Known limitations

- **Whole-collection scan on write.** `record()` lists the whole collection to
  decide what to trim. The DSH KV adapter has no secondary indexes, so this is a
  full scan per append. A SQL adapter with an `at` index would do far better;
  the `data` contract does not expose one yet.
- **No atomic trim.** Appending and trimming are two data-port operations. If
  the process stops between them the trail is temporarily over the cap, which
  the next append repairs. Nothing is lost.
- **Not a WORM store.** "Append-only" is a provider policy, not an engine
  guarantee: the `data` port can still overwrite or remove rows. Integrity
  relies on the engine's access control and backups.
- **Random ids.** Ids are UUIDv4, not time-ordered; ordering never depends on
  them except as a tie-break inside one millisecond.
- **Offset cursors.** The cursor is a numeric offset, so entries appended
  between two pages can shift a row across the page boundary. Governance reads
  tolerate that; a snapshot-consistent export would need an `at`+`id` keyset
  cursor, which needs an indexed data engine.
- **Query validation happens twice.** The gateway validates `route.query` before
  the handler runs; the handler still re-reads `request.query` because the
  gateway keeps the raw `URLSearchParams` rather than the parsed object.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/audit-default
```

The suite covers registration and disposal, append and trimming, retention,
filtering, cursor paging and the route envelope.
