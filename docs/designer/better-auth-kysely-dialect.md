# Design: A Kysely Dialect over DSH Domain Storage for Better Auth

- Status: **implemented** — `packages/kysely-dsh-dialect` (`@veren/kysely-dsh-dialect`),
  wired in `plugins/auth`; see "As-built notes" at the end
- Scope: new standalone package `packages/kysely-dsh-dialect` (`@veren/kysely-dsh-dialect`);
  `plugins/auth` (`@veren/web-login-gate`) becomes a consumer only
- Related code: `plugins/auth/src/adapter.ts` (current hand-written `DBAdapter`), `plugins/auth/src/auth.ts`
- Verified against: `kysely@0.29.6`, `better-auth@1.7.8` (ships `@better-auth/kysely-adapter`)

## 1. Motivation

The current adapter (`plugins/auth/src/adapter.ts`) implements Better Auth's low-level
`DBAdapter` interface directly: 8 CRUD operations, hand-written `where` semantics
(AND/OR grouping, 10 operators, insensitive mode), sorting, pagination, and `select`
projection — roughly 220 lines of logic whose correctness is our responsibility.

Better Auth already ships a maintained Kysely adapter (`kyselyAdapter(db: Kysely<any>, config)`).
If DSH domain storage can be exposed to Kysely as a "database", all query semantics are
compiled by Kysely itself and the hand-written logic disappears.

## 2. Verified facts

1. **`@better-auth/kysely-adapter` is public API of better-auth 1.7.8.**
   Signature (from `dist` type declarations):
   ```ts
   kyselyAdapter(db: Kysely<any>, config?: {
     type?: 'postgres' | 'mysql' | 'sqlite' | 'mssql'
     transaction?: boolean      // default false
     usePlural?: boolean        // default false
     debugLogs?: DBAdapterDebugLogOption
   })
   ```
2. **Kysely `Dialect` is exactly four factories** (v0.29.6 `dist/dialect/dialect.d.ts`):
   `createDriver()`, `createQueryCompiler()`, `createAdapter()`, `createIntrospector(db)`.
3. **`Driver` receives compiled queries, not ASTs.** `DatabaseConnection.executeQuery<T>(
   compiledQuery: CompiledQuery)` is the execution hook. `CompiledQuery` is
   `{ sql: string, parameters: readonly unknown[], query, queryId }` — nothing in the
   contract requires `sql` to be SQL text.
4. **`DatabaseIntrospector` needs only `getSchemas()` and `getTables()`.** Better Auth's
   schema check (`diffSchema`) consumes this, so a correct introspector also unlocks
   Better Auth's schema-diff and migration tooling paths.

## 3. Core design

The key trick: **a custom `QueryCompiler` serializes the Kysely operation-node tree into a
structured JSON instruction placed in `CompiledQuery.sql`**. The `Driver` parses that
instruction and maps it onto `KvTable` operations. This is the same approach community
dialects use for non-SQL backends (Cloudflare D1 drivers, S3 Select, etc.) — it uses
Kysely's official extension surface, not a hack.

### 3.1 Instruction format (compiled into `sql`)

```jsonc
{
  "v": 1,                          // instruction format version
  "op": "select",                  // select | insert | update | delete
  "from": "user",                  // logical table == KvTable name
  "columns": ["id", "email"],      // projection (select only)
  "where": [                       // AND/OR tree, pre-flattened by the compiler
    { "connector": "AND", "field": "email", "cmp": "eq", "value": "..." },
    { "connector": "OR",  "expr": [ /* nested group */ ] }
  ],
  "values": { "id": "...", "email": "..." },  // insert/update payloads
  "orderBy": [{ "field": "createdAt", "dir": "desc" }],
  "limit": 10, "offset": 0,
  "returning": ["id"]
}
```

All values travel inside this JSON document; `parameters` stays empty. This keeps the
whole query atomic and avoids positional-parameter re-binding bugs.

### 3.2 Execution mapping

| Kysely op | Domain storage op |
|---|---|
| `select` | `table.entries()` → filter (`where`) → sort (`orderBy`) → slice (`offset/limit`) → project (`columns`) |
| `insert` | `table.put('<model>:<id>', row)` |
| `update` | scan + match → `table.put(key, { ...row, ...values })` |
| `delete` | scan + match → `table.delete(key)` |

Reads are synchronous memory hits; writes go through the domain's single durable write
chain, exactly like today's adapter. The medium (json/sqlite) remains whatever the
storage group routes for the `web-login-gate` domain.

### 3.3 Package layout (respects the 300-line/file, single-responsibility rules)

The dialect is a **standalone reusable package** — it depends only on `kysely` and the
`KvTable` surface of `@deepseek-ai/dsh-storage-domain`, with zero knowledge of Better
Auth or the login gate. Better Auth wiring stays in the plugin.

```
packages/kysely-dsh-dialect/
├── package.json          # @veren/kysely-dsh-dialect; deps: kysely, @deepseek-ai/dsh-storage-domain
├── src/
│   ├── dialect.ts        # assembles the four factories; ~40 lines
│   ├── compiler.ts       # QueryCompiler: walks operation-node tree → instruction JSON; ~200 lines
│   ├── executor.ts       # instruction → KvTable operations + in-memory filter/sort/paginate; ~180 lines
│   ├── driver.ts         # Driver + single DatabaseConnection; transaction hooks are no-ops; ~90 lines
│   ├── introspector.ts   # exposes declared tables metadata; ~60 lines
│   └── index.ts          # DomainStorageDialect export + helper to open Kysely over a domain
├── tests/                # vitest unit tests (no Better Auth dependency)
├── README.md / README.cn.md
└── tsconfig.json
```

### 3.4 Dialect capability choices

- `createAdapter()`: reuse `SqliteAdapter`-style capabilities — `supportsTransactionalDdl: false`,
  `supportsCreateIfNotExists: true`, `supportsReturning: false`.
- Transactions: `Driver.beginTransaction/commit/rollback` are no-ops; Better Auth config
  passes `transaction: false` so operations run sequentially (same as today).
- Dates: keep storing ISO strings (KvTable JSON medium); declare the Kysely DB types with
  string timestamps so no runtime date conversion occurs.

### 3.5 Wiring change in `auth.ts`

```ts
// plugins/auth/src/auth.ts
import { Kysely } from 'kysely'
import { kyselyAdapter } from 'better-auth/adapters/kysely-adapter'
import { DomainStorageDialect } from '@veren/kysely-dsh-dialect'

betterAuth({
  database: kyselyAdapter(
    new Kysely({ dialect: new DomainStorageDialect(inputs.domain) }),
    { type: 'sqlite', transaction: false },
  ),
})
```

`type: 'sqlite'` is chosen because it semantically matches domain storage best:
dynamically typed values, no server-side transactions.

## 4. Benefits

- Delete ~220 lines of hand-written query semantics; correctness of where/sort/pagination
  is delegated to Kysely's compiler + runtime.
- Better Auth's schema check (`diffSchema`) and CLI migration paths become reachable via
  the introspector, which the current custom `DBAdapter` cannot participate in.
- The dialect is generic over DSH storage domains: any future consumer of Kysely on top
  of a DSH domain reuses it, not just Better Auth. As a standalone package it is
  independently versioned, independently testable, and reusable by any app or plugin —
  it carries no Better Auth or login-gate coupling.

## 5. Risks and open questions

1. **Compiler surface area.** Kysely's operation-node tree is large. Scope: support only
   the node kinds Better Auth's Kysely adapter actually emits (select/insert/update/delete,
   where comparisons, orderBy, limit/offset, returning). Unknown node kinds must fail
   loud with a stable error code (e.g. `DIALECT_NODE_UNSUPPORTED`).
2. **Schema check strictness.** `diffSchema` may demand column metadata fidelity; the
   introspector initially reports columns as dynamically typed (`dataType: 'any'`). If
   Better Auth flags false positives, we may need to seed column metadata from Better
   Auth's declared schemas.
3. **New direct dependency.** `kysely` is added to `packages/kysely-dsh-dialect/package.json`
   (currently transitive only). Pin it to the version better-auth resolves (`0.29.6`) to
   avoid dual-instance type mismatches; `plugins/auth` then depends on
   `@veren/kysely-dsh-dialect` instead of on `kysely` directly.
4. **`update` returning row counts.** Better Auth relies on affected-row counts in some
   paths (see the MySQL `FOUND_ROWS` note in its adapter docs); the executor must return
   `numChangedRows`/`numAffectedRows` accurately on every `update`/`delete`.

## 6. Estimated effort

~550–650 lines including bilingual comments and unit tests, split across the package's
six source files plus `packages/kysely-dsh-dialect/tests/*.spec.ts` (round-trip:
insert → find by where → update → delete, and instruction-compiler snapshot tests for
unsupported-node failure). The plugin side changes are a few wiring lines in
`plugins/auth/src/auth.ts` plus a `package.json` dependency swap.

## 7. As-built notes (differences from the proposal)

1. **Import path.** `better-auth/adapters/kysely-adapter` is not in better-auth's
   public `exports`; the plugin depends on the published
   `@better-auth/kysely-adapter@1.7.8` directly.
2. **Source file count.** The package keeps five source files (`types`,
   `compiler`, `executor`, `dialect`, `index`) — the driver and dialect-adapter
   assembly live together in `dialect.ts`.
3. **Schema check.** Risk #2 resolved by turning Better Auth's SQL-flavored column
   diff off (`advanced.database.validateSchema: false`): domain storage is
   schema-loose by design and the medium is versioned by the domain spec, so the
   column-exact diff does not apply. The introspector remains available for Kysely
   tooling.
4. **Compiler details learned from better-auth's emitted shapes:** every select is
   wrapped in a subquery (`select * from (<inner>) as primary`) and is flattened;
   insensitive comparisons compile to `lower(col) like lower(?)` and map to
   `ilike`; insert cell values may arrive as raw primitives or `ValueNode`s.
   Update/delete results must fill `numAffectedRows`, which Kysely maps to
   `numUpdatedRows`.
5. **Dependency pin.** `kysely` is pinned to `0.29.6` in the package (matching
   better-auth's resolution).
