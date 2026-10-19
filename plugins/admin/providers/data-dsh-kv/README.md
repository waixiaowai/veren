# @veren/admin-data-dsh-kv

The `data` capability provider for the DSH admin platform, backed by one
self-declared DSH storage domain. It implements `AdminDatabase` from
`@veren/admin-contract` and registers itself with the kernel, so every consumer
keeps talking to the stable `ctx.adminData` façade and never sees the medium.

## What it provides

- `AdminDatabase` (`table`, `transaction`, `health`, `features`) implemented in
  `src/adapter.ts` over a structural KV handle.
- The `admin_data` domain declaration in `src/domain.ts`.
- Provider registration in `src/plugin.ts`: manifest `{ id: 'dsh-kv',
  capability: 'data', contract: '^1.0', priority: 0, dataDomain: 'admin_data' }`,
  wired through `ctx.effect`.
- `features = { transactions: false, secondaryIndexes: false, fullText: false }`:
  the engine reports what it cannot do instead of pretending.

Priority `0` leaves room for a higher-priority provider (for example a SQL
engine) to take over without touching this package.

## Storage layout

One domain, one table, one document per record:

| item | value |
|---|---|
| domain | `admin_data`, version `1`, layout `per-record` |
| table | `records` |
| key | `` `${collection}:${id}` `` |
| value | the stored record object |

The record schema is a loose object that only requires `id: string`, because
each capability owns and evolves the rest of its fields independently. A
hand-edited or truncated document without an `id` still fails the domain open
loudly instead of being skipped silently.

Collections are virtual: a repository is the key prefix `` `${collection}:` ``
inside the single table, so adding a capability needs no schema change and no
migration. `find('u1')` in collection `admin_users` reads key
`admin_users:u1`; `list()` and `size` only consider keys under that prefix, so
`admin_user` and `admin_users` never see each other's records.

The medium (`json`, `sqlite`, …) is decided by the storage group's
`backend`/`routes` configuration; this plugin never opens a backend directly.

## Configuration

```yaml
storage:
  backend: json        # default backend name for the domain
  routes:              # per-domain overrides: domain name -> backend name
    admin_data: sqlite
```

| field | default | meaning |
|---|---|---|
| `storage.backend` | `json` | backend serving the domain when no route matches |
| `storage.routes` | `{}` | per-domain overrides; the `admin_data` entry wins |

Every name in `storage.backend` and `storage.routes` must be a registered
backend. A typo fails the plugin load with the offending name and the list of
registered names, instead of silently writing to another medium.

## Transactions: the degraded guarantee

`transaction(work)` runs `work` through one internal promise chain, so two
overlapping transactions never interleave: the second starts only after the
first settles. It returns the work's value and **does not roll back**.

Consequences a caller must plan for:

- A throwing work unit rejects to the caller; records written before the throw
  stay written.
- A failing transaction does not poison the chain: the next transaction runs.
- Writes issued outside a transaction are not serialized against transactions
  (the domain has its own single write chain per write, so individual writes
  still land in order, but a read-modify-write sequence is only protected inside
  `transaction`).

This is the KV reconciliation path: deployments that need atomic multi-record
changes must make their writes idempotent (or re-read and repair after a
failure), or replace this provider with a transactional engine. The capability
catalog advertises `transactions: false` so modules can refuse to run here.

## Reading, listing and size

Reads are synchronous because the storage domain keeps validated state in
memory. `list()` and `size` are **scans**: the KV has no secondary index, so
each call walks the table's key snapshot and filters by prefix. Cost grows with
the number of records in the whole table, not only in the requested collection.

## Health

`health()` touches the table handle: `{ status: 'ok' }` while it answers,
`{ status: 'down', detail }` when it throws (closed domain, released backend,
corrupt medium). The kernel publishes the verdict through
`refreshHealth()`.

## Known limitations

- **No atomic transactions.** See the degraded guarantee above; `features`
  reports this truthfully.
- **No secondary indexes and no full text.** Any query beyond `id` is a scan
  performed by the consumer over `list()`.
- **No per-collection validation.** Only `id` is checked on write and by the
  durable schema; a record is stored as handed in, so each capability must
  validate its own fields before `save`.
- **`find`/`list` trust the namespace.** Values are narrowed to the requested
  entity type, not parsed; a record stored under another shape comes back as-is.
- **Collection names must not contain `:`.** The separator defines the prefix,
  so `a:b` as a collection name would alias into collection `a`.
- **One open per domain name.** The storage facility rejects a second open of
  `admin_data`; two deployments in one process must not both load this plugin.
- **No migration importer.** The manifest declares no `migrations` sources;
  moving records in or out is a consumer task.
- **No caching layer.** Every `list`/`size` walks the table; hot dashboards
  should cache in their own module.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/data-dsh-kv
```

The suite runs the adapter against a `Map`-backed fake domain (CRUD per
collection, prefix isolation, missing-id rejection, transaction serialization
and failure propagation, health) and drives the plugin through a real
`AdminKernel` (registration, façade access, loud backend validation, disposal
closing the domain and unregistering the capability).
