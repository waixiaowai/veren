# @veren/admin-data-postgres

The recommended production `data` provider for the DSH admin platform. It
implements `AdminDatabase` from `@veren/admin-contract` over PostgreSQL and
registers itself with the kernel, so every consumer keeps talking to the stable
`ctx.adminData` façade and never sees the database.

Use it when the deployment needs durable, concurrent, transactional storage and
an operator-managed PostgreSQL instance. Skip it for embedded or zero-config
deployments; keep `@veren/admin-data-dsh-kv` (DSH storage domain, JSON/SQLite
medium) for those.

## What it provides

- `AdminDatabase` (`table`, `transaction`, `health`, `features`) in
  `src/adapter.ts`.
- `veren_`-prefixed tables declared in `src/schema.ts`, created by an
  idempotent startup bootstrap.
- SQL transport and transaction handling in `src/store.ts`, with `pg` owned by
  `src/plugin.ts`.
- Provider manifest `{ id: 'postgres', capability: 'data', contract: '^1.0',
  priority: 10, dataDomain: 'veren_admin' }`. Priority 10 outranks the KV
  fallback (0), so PostgreSQL serves `data` whenever both rows are enabled.
- `features = { transactions: true, secondaryIndexes: false, fullText: false }`.
  Transactions are real. `secondaryIndexes` stays false because the port has no
  ad-hoc query: the indexes below serve operators and future SQL consumers, not
  a module-facing query surface.

## Tables and indexes

Every platform table has `id text PRIMARY KEY`, `data jsonb NOT NULL` (the
complete record, round-tripped unchanged), and nullable projected columns for
the fields worth indexing. Projected columns are nullable because the port only
validates `id`; a missing field must never turn a KV-compatible write into a
constraint error.

| table | collection | projected columns | indexes |
|---|---|---|---|
| `veren_users` | `admin_users` | `email`, `name`, `active`, `password_hash`, `created_at`, `last_login_at` | unique `(lower(email))`, `(active)`, `(created_at DESC)` |
| `veren_sessions` | `admin_sessions` | `user_id`, `token_hash`, `created_at`, `expires_at`, `last_seen_at` | unique `(token_hash)`, `(user_id)`, `(expires_at)` |
| `veren_tokens` | `admin_tokens` | `user_id`, `name`, `prefix`, `secret_hash`, `scopes text[]`, `created_at`, `last_used_at`, `revoked_at` | unique `(secret_hash)`, `(user_id)`, `(prefix)` |
| `veren_roles` | `admin_roles` | `label`, `permissions text[]`, `created_at` | `(created_at DESC)` |
| `veren_bindings` | `admin_bindings` | `user_id`, `role_id`, `created_at` | unique `(user_id, role_id)`, `(role_id)` |
| `veren_audit` | `admin_audit` | `at`, `actor_id`, `actor_label`, `action`, `result`, `target`, `request_id`, `ip`, `detail jsonb` | `(at DESC)`, `(actor_id, at DESC)`, `(action)`, `(result)` |
| `veren_records` | any other collection | `collection`, `id`, `data` | primary key `(collection, id)`, `(collection)` |

Index names follow `<table>_<purpose>`: `veren_users_email_key`,
`veren_sessions_token_hash_key`, `veren_tokens_secret_hash_key`,
`veren_bindings_user_role_key`, `veren_audit_at_idx`, and so on.

## Configuration

Connection values are profile config, never code constants:

```yaml
- id: admin-data-postgres
  name: '@veren/admin-data-postgres'
  config:
    host: 127.0.0.1
    port: 5432
    user: veren
    password: !!js process.env.VEREN_PG_PASSWORD ?? ''
    database: veren_admin
    schema: public
    ssl: false
    maxConnections: 10
    migrateOnBoot: true
```

| field | default | meaning |
|---|---|---|
| `host` | `127.0.0.1` | PostgreSQL host |
| `port` | `5432` | PostgreSQL port |
| `user` | `veren` | login role |
| `password` | `''` | login password; prefer `!!js process.env.*` over a literal |
| `database` | `veren_admin` | database name; it must already exist |
| `schema` | `public` | schema holding the tables; created when absent |
| `ssl` | `false` | require TLS with certificate verification |
| `maxConnections` | `10` | pooled connection cap |
| `connectTimeoutMs` | `10000` | connection attempt timeout |
| `migrateOnBoot` | `true` | run the idempotent bootstrap on load |

The pool pins `search_path` to `schema`, so a role-named schema cannot capture
the `veren_` tables. The role needs `CREATE` on the database for a non-existing
schema and ordinary table/index privileges on the target schema.

## Schema bootstrap: automatic, idempotent

The plugin bootstraps the schema on load, inside one transaction serialized by
`pg_advisory_xact_lock`:

1. `CREATE SCHEMA` when the configured schema is absent (checked against
   `pg_namespace`, so a redeploy needs no `CREATE` privilege on the database).
2. `CREATE TABLE IF NOT EXISTS` for every table.
3. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for every projected column.
4. `CREATE [UNIQUE] INDEX IF NOT EXISTS` for every index.

Choice and tradeoff: this removes a separate deployment step and makes a fresh
install work with one command. The cost is that the bootstrap is **additive
only** — it adds missing tables and columns, but never renames, retypes, or
drops anything, and it keeps no applied-version history. Destructive evolution
stays a manual migration. For stricter change control, set `migrateOnBoot:
false` and call the exported `ensureSchema(pool, schema)` from a deployment job;
the same function is what the plugin runs. A failed bootstrap stops the plugin
load; it never serves a half-migrated schema.

## Read model and transactions

The port's reads are synchronous, so the adapter keeps a write-through mirror:

- Startup runs `loadAll()` once and seeds the mirror.
- Writes reach PostgreSQL first; the mirror changes only after the database
  accepted the write. A failed write never leaves a record visible.
- `find`, `list`, and `size` answer from memory. Memory cost is proportional to
  the total number of stored records; this is an admin-scale store, not an
  analytics warehouse.
- The mirror is process-local. **One writer process per database is the
  supported topology**: a second DSH process sharing the same tables would keep
  a stale mirror until restart.

`transaction(work)` checks out one connection, runs `BEGIN`, hands the work a
transaction-bound unit of work, then `COMMIT`s and folds its pending changes
into the mirror. Work inside the transaction reads its own uncommitted writes
through an overlay; readers outside it keep seeing committed data. A thrown
work unit rolls back and discards the overlay. Transactions are serialized
against each other by an internal queue. Writes issued outside a transaction are
not serialized against that queue (individual statements still land in order).

## Switching back to the JSON backend

`@veren/admin-app` enables PostgreSQL by default and ships the DSH KV row
disabled. Disable the PostgreSQL row, enable the KV row, and make sure the
profile has `storage` and `storageDomain`:

```yaml
- id: admin-data-postgres
  disabled: true
- id: admin-data-dsh-kv
  disabled: false
  config:
    storage:
      backend: json
```

The KV adapter now encodes both key segments as hex and joins them with `_`, so
the JSON backend's per-record path-safe rule (`/^[a-zA-Z0-9_-]+$/`) accepts
every collection name and id, including `:`, `/`, `.`, and non-ASCII text. The
two providers expose the same `ctx.adminData` port; no consumer code changes.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/data-postgres
```

The unit suite covers the adapter over a fake record store (mirror seeding,
CRUD, write-through ordering, transaction isolation/rollback/serialization,
health), SQL binding and idempotent DDL, the store's transaction boundaries, and
plugin registration/disposal with a recording pool.

The integration suite exercises a real server and self-skips when no URL is set:

```powershell
$env:VEREN_PG_TEST_URL = 'postgres://veren:veren@127.0.0.1:5432/veren_admin'
pnpm exec vitest run --root plugins/admin/providers/data-postgres
```

It creates a throwaway schema, verifies the DDL footprint, round-trips every
platform collection plus the fallback table, and checks transaction commit and
rollback, then drops that schema. The target database and login must exist.

## Known limitations

- **Process-local mirror.** No cross-process invalidation; one writer process
  per database.
- **Additive bootstrap only.** No down migrations, version history, or
  destructive schema changes.
- **No ad-hoc query port.** Modules still read whole collections through
  `list()`; the SQL indexes are for operators and future SQL consumers.
- **No full-text search.**
- **One transaction at a time.** Transactions are serialized for deterministic
  lock order and bounded pool use.
- **Fallback table for unknown collections.** Only the six platform collections
  get a dedicated table; new collections land in `veren_records` until a
  dedicated schema is added.
- **No data migration from the KV provider.** Moving existing records between
  providers is an operator task.
