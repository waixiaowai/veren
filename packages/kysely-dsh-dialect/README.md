# @veren/kysely-dsh-dialect

A Kysely `Dialect` that runs type-safe queries directly against a DSH storage
domain's `KvTable`s. Use it when Kysely — or anything built on it, such as
Better Auth's `kyselyAdapter` — must read and write records stored in a DSH
storage domain. Skip it when the backend is a real SQL database: an official
Kysely dialect is simpler and faster.

## How it works

- `createQueryCompiler` serializes Kysely's operation-node tree into a JSON
  instruction carried in `CompiledQuery.sql` (`parameters` stays empty).
- `createDriver` exposes a single connection whose `executeQuery` parses the
  instruction and maps it onto `KvTable` operations: reads scan the
  synchronous in-memory snapshot; writes queue on the domain's single durable
  write chain.
- Transactions are no-ops (the write chain already serializes mutations);
  capability flags say so (`supportsTransactionalDdl: false`,
  `supportsMultipleConnections: false`).
- Unsupported shapes (joins, upserts, aggregates) fail loud with a stable
  `DialectError.code` such as `DIALECT_NODE_UNSUPPORTED`.

## Usage

```ts
import { kyselyAdapter } from 'better-auth/adapters/kysely-adapter'
import { openDomainKysely } from '@veren/kysely-dsh-dialect'

const db = openDomainKysely(domain, ['user', 'session', 'account', 'verification'])

betterAuth({
  database: kyselyAdapter(db, { type: 'sqlite', transaction: false }),
})
```

Or plain Kysely:

```ts
const rows = await db.selectFrom('user').selectAll().where('email', '=', 'a@b.c').execute()
```

The caller owns the domain lifecycle (`domain.close()`); the dialect never
opens or closes the domain.

## Constraints

- Single-table CRUD only: `select` / `insert` / `update` / `delete` with
  where comparisons, `in` lists, LIKE/ILIKE, order-by, limit/offset,
  returning.
- Inserts must carry a string `id`; storage keys are `<table>:<id>`.
- No joins, aggregates, CTEs, upserts, or schema DDL.

See `docs/designer/better-auth-kysely-dialect.md` for the full design.
中文文档：[README.cn.md](./README.cn.md)
