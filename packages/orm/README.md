# @veren/orm

A small, environment-agnostic ORM for TypeScript services. It gives you typed
entities, a parameterized query builder, a cascade persistence pipeline, schema
synchronization and versioned migrations — while keeping the core free of Node
built-ins so the same code runs on Node, Cloudflare Workers, Deno, Bun and any
other `fetch` runtime that can provide a database client.

The design follows the TypeORM reconstruction in [`design/typeorm`](../../design/typeorm/),
trimmed to the parts that matter for this workspace: **declaration before build**,
**dialect differences confined to one face**, **fixed persistence phases**, and
**dangerous capabilities explicit**.

## When to use it

Use `@veren/orm` when a feature needs typed object graphs persisted across more
than one database dialect, when business code must not import `pg`/`mysql2`/
`node:sqlite` directly, or when the same service must run on Node and on a
serverless runtime. Skip it when a single platform-locked query builder already
covers the workload.

## Install

```bash
pnpm add @veren/orm
```

Driver clients are optional peers, loaded lazily only when a connection is
actually opened:

```bash
pnpm add pg          # PostgreSQL
pnpm add mysql2      # MySQL / MariaDB
# SQLite uses the built-in node:sqlite (Node 22.5+), no package needed
```

## Quick start (Node + SQLite)

```ts
import {
  Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn,
} from '@veren/orm'
import '@veren/orm/driver/sqlite'

@Entity('users')
class User {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @OneToMany(() => Post, (post) => post.author)
  posts?: Post[]
}

@Entity('posts')
class Post {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 200 })
  title!: string

  @ManyToOne(() => User, (user) => user.posts)
  author!: User
}

const dataSource = new DataSource({
  type: 'sqlite',
  filename: 'app.db',      // omit for an in-memory database
  entities: [User, Post],
  synchronize: true,       // development only
})
await dataSource.initialize()

const users = dataSource.getRepository(User)
const user = await users.save({ name: 'Ada' })
const posts = dataSource.getRepository(Post)
await posts.save({ title: 'Hello', author: user })

const loaded = await posts.findOne({ where: { author: { id: user.id } }, relations: { author: true } })
await dataSource.destroy()
```

Entities must declare their column types explicitly. The library deliberately
does **not** depend on `reflect-metadata`; `type` is part of the declaration.

Decorator users need two compiler options:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "useDefineForClassFields": false
  }
}
```

`EntitySchema` users do not need either option. `node:sqlite` requires Node
22.5+ (pass `--experimental-sqlite` on older lines).

## Cloudflare D1 and other runtimes

`DataSourceOptions.client` is the environment bridge: one object with a
`query(sql, parameters)` method. Any runtime that can produce such an object can
host the whole ORM.

```ts
import { DataSource } from '@veren/orm'
import { createD1Client } from '@veren/orm/driver/d1'

export default {
  async fetch(request: Request, env: Env) {
    const dataSource = new DataSource({
      type: 'd1',
      client: createD1Client(env.DB),
      entities: [User, Post],
    })
    await dataSource.initialize()
    const users = await dataSource.getRepository(User).find()
    return Response.json(users)
  },
}
```

D1 has no explicit transactions, so the driver declares
`capabilities.transactions = false`; calling `dataSource.transaction()` fails
loudly instead of pretending. Reads and writes still work.

For a custom client (libSQL, Neon HTTP, a test double):

```ts
const dataSource = new DataSource({
  type: 'sqlite',
  client: {
    async query(sql, parameters) {
      const result = await myClient.execute(sql, parameters)
      return { rows: result.rows, affected: result.changes }
    },
  },
  entities: [User],
})
```

## Declarative entities (no decorators)

```ts
import { EntitySchema } from '@veren/orm'

const UserSchema = new EntitySchema<{ id?: number; name: string }>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'integer', primary: true, generated: true },
    name: { type: 'varchar', length: 64 },
  },
})
```

Decorators and `EntitySchema` feed the same metadata builder; mixing both in one
data source is supported. Relation targets are resolved lazily and decorated
targets are pulled in automatically even if they are not repeated in `entities`.

## Querying

```ts
import { Between, ILike, In, IsNull, Not } from '@veren/orm'

await users.find({
  where: [
    { name: ILike('%ada%'), age: Between(18, 99) },
    { name: In(['Ada', 'Grace']) },
  ],
  order: { name: 'ASC' },
  take: 20,
  skip: 0,
  relations: { posts: true },
  withDeleted: false,
})

await users.createQueryBuilder('u')
  .where('u.name = :name', { name: 'Ada' })
  .orderBy('u.id', 'DESC')
  .getMany()
```

Supported operators: `Equal`, `Not`, `In`, `IsNull`, `Like`, `ILike`, `Between`,
`LessThan`, `LessThanOrEqual`, `MoreThan`, `MoreThanOrEqual` and `Raw`.
Operators nest, so `Not(In([1, 2]))` becomes `col NOT IN (...)`. Nested relation
conditions compile to `EXISTS` subqueries — never a cartesian product.

`getRawMany()` returns raw rows; `getMany()` assembles entities. Relation loading
uses one additional query per relation layer, grouped by primary key.

## Persistence

`save` / `remove` / `softRemove` / `recover` run the cascade pipeline:

1. owning-side relations (`many-to-one`, owning `one-to-one`) save first;
2. the entity itself is inserted or updated;
3. `one-to-many` children save afterwards with the parent key attached;
4. `many-to-many` junction rows are rebuilt last.

A repeated `save` of an unchanged entity performs no write (only a baseline
read). Optimistic locking via `@VersionColumn()` rejects stale writes with
`OptimisticLockVersionMismatchError`.

```ts
await dataSource.transaction(async (manager) => {
  const repo = manager.getRepository(User)
  await repo.save(user)
  await manager.getRepository(Post).save(post)
}) // commit on return, rollback on throw
```

## Schema sync and migrations

```ts
await dataSource.schemaLog()      // read-only diff, safe in production
await dataSource.synchronize()    // apply diff (dangerous switch)
await dataSource.runMigrations()  // run pending migrations
await dataSource.undoLastMigration()
```

Migration classes must end with a 13-digit timestamp:

```ts
import type { MigrationInterface, QueryRunner } from '@veren/orm'

export class CreateUsers1712345678901 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE users')
  }
}
```

The ledger table defaults to `migrations`; override it with
`migrationsTableName`. Each migration runs in its own transaction when the
dialect supports transactions.

## Thin entries

The core has no framework dependency. Adapters are separate sub-paths and load
only what they need.

### DSH / Cordis

```ts
import * as ormPlugin from '@veren/orm/cordis'

ctx.plugin(ormPlugin, {
  dataSource,
  autoInitialize: true,
})

// afterwards
const users = await ctx.verenOrm.getRepository(User).find()
await ctx.verenOrm.transaction(async (manager) => { /* ... */ })
```

The plugin registers `ctx.verenOrm` and binds the data source lifecycle to the
fiber: unloading destroys the data source and releases every connection.

### Hono

```ts
import { createHonoOrmMiddleware, getHonoOrm } from '@veren/orm/hono'

app.use('*', createHonoOrmMiddleware(dataSource, { transaction: true }))
app.get('/users', async (c) => c.json(await getHonoOrm(c).getRepository(User).find()))
```

The middleware commits when the response status is below 400, rolls back
otherwise, and always returns the connection.

### Express

```ts
import { createExpressOrmMiddleware, getExpressOrm } from '@veren/orm/express'

app.use(createExpressOrmMiddleware(dataSource))
app.get('/users', async (req, res) => {
  res.json(await getExpressOrm(req).getRepository(User).find())
})
```

The middleware commits on `finish` (status < 400), rolls back on `close` or a
thrown error, and releases exactly once.

## Adding a database dialect

Two layers are extensible independently:

1. **Dialect** — escaping, placeholders, type mapping, transaction statements.
2. **Environment bridge** — a `SqlClient` that knows how to talk to a concrete
   driver.

Register a dialect once, then refer to it by `type`:

```ts
import { BaseDriver, registerDriver, singleClientPool } from '@veren/orm'

registerDriver({
  type: 'my-db',
  create: (options) => new BaseDriver(new MyDialect(), options, async () => {
    const client = await openMyConnection(options)
    return singleClientPool(client)
  }),
})

const dataSource = new DataSource({ type: 'my-db', /* ... */ })
```

The core contains no `if (type === 'postgres')` branches; everything above the
driver goes through `DriverCapabilities` (returning, transactions, savepoints,
UUID generation).

## Errors and logging

Every failure is an `OrmError` subclass with a stable `code`:
`QUERY_FAILED`, `MISSING_PRIMARY_COLUMN`, `EMPTY_CRITERIA`,
`OPTIMISTIC_LOCK_MISMATCH`, `MISSING_DRIVER`, and so on. SQL failures preserve
the original driver error on `driverError` together with `query` and
`parameters` — never a bare driver exception.

Logging is off by default. Enable it with `logging: true | 'all' | ['query', 'error']`
or inject a custom `Logger`.

## Current limits (v0.1)

- No embedded objects, inheritance or tree repositories yet.
- Manual `innerJoin` / `leftJoin` on many-to-many relations is not supported;
  use `relations` loading instead.
- `schemaLog` diffs table existence and adds missing columns; it does not drop
  columns or indexes.
- No CLI package and no query-result cache yet.
- PostgreSQL and MySQL SQL generation is unit-tested; live-database tests are
  opt-in and not part of the default suite.

## Scripts

```bash
pnpm build       # tsc → dist
pnpm test        # vitest
pnpm coverage    # vitest + V8 coverage (HTML in coverage/)
pnpm typecheck   # tsc --noEmit
```

## License

MIT
