# @veren/orm

一个面向 TypeScript 服务端的小型、环境无关的 ORM：类型化实体、参数化查询构建器、
级联持久化管线、模式同步与版本化迁移。核心不 import 任何 Node 内建，因此同一份
业务代码可以跑在 Node、Cloudflare Workers、Deno、Bun 以及任何能提供数据库客户端的
`fetch` 运行时上。

设计依据 [`design/typeorm`](../../design/typeorm/) 的逆向重建方案，按本工作区的
实际需要收敛为四条铁律：**声明先于构建**、**方言差异收敛到驱动双面**、
**持久化按固定阶段推进**、**危险能力显式开关**。

## 什么时候用

当一个功能需要把类型化对象图持久化到不止一种数据库方言、业务代码不应直接 import
`pg`/`mysql2`/`node:sqlite`，或者同一个服务既要跑 Node 又要跑 Serverless 时，用
`@veren/orm`。如果单一平台锁定的查询构建器已经够用，就不必引入它。

## 安装

```bash
pnpm add @veren/orm
```

驱动客户端是可选对等依赖，只有真正建立连接时才惰性加载：

```bash
pnpm add pg          # PostgreSQL
pnpm add mysql2      # MySQL / MariaDB
# SQLite 使用 Node 内建 node:sqlite（22.5+），无需额外包
```

## 快速开始（Node + SQLite）

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
  filename: 'app.db',      // 省略则使用内存库
  entities: [User, Post],
  synchronize: true,       // 仅开发环境
})
await dataSource.initialize()

const users = dataSource.getRepository(User)
const user = await users.save({ name: 'Ada' })
const posts = dataSource.getRepository(Post)
await posts.save({ title: 'Hello', author: user })

const loaded = await posts.findOne({ where: { author: { id: user.id } }, relations: { author: true } })
await dataSource.destroy()
```

列类型必须显式声明。本库刻意不依赖 `reflect-metadata`，`type` 是声明的一部分。

使用装饰器需要两个编译选项：

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "useDefineForClassFields": false
  }
}
```

使用 `EntitySchema` 则不需要这两个选项。`node:sqlite` 需要 Node 22.5+
（更低版本加 `--experimental-sqlite`）。

## Cloudflare D1 与其他运行时

`DataSourceOptions.client` 就是环境桥：一个带 `query(sql, parameters)` 方法的对象。
任何运行时只要能产出这个对象，就能承载整套 ORM。

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

D1 没有显式事务，驱动会把 `capabilities.transactions` 声明为 `false`；调用
`dataSource.transaction()` 会明确失败，而不是假装成功。读写本身照常可用。

自定义客户端（libSQL、Neon HTTP、测试替身）：

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

## 声明式实体（无装饰器）

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

装饰器与 `EntitySchema` 进入同一条元数据构建管线；同一个数据源里混用也可以。
关系目标惰性解析，被装饰的目标即使没有重复写进 `entities` 也会自动纳入。

## 查询

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

支持的操作符：`Equal`、`Not`、`In`、`IsNull`、`Like`、`ILike`、`Between`、
`LessThan`、`LessThanOrEqual`、`MoreThan`、`MoreThanOrEqual`、`Raw`。操作符可嵌套，
因此 `Not(In([1, 2]))` 生成 `col NOT IN (...)`。嵌套关系条件翻译成 `EXISTS` 子查询，
不会产生笛卡尔积。

`getRawMany()` 返回原始行；`getMany()` 装配实体。关系装载按「每层一条附加查询」
执行，并按主键分组，没有 N+1。

## 持久化

`save` / `remove` / `softRemove` / `recover` 走级联管线：

1. 拥有侧关系（`many-to-one`、拥有侧 `one-to-one`）先保存；
2. 当前实体插入或更新；
3. `one-to-many` 子实体随后保存，并挂上父键；
4. `many-to-many` 中间表行最后重建。

对没有变化的实体重复 `save` 只做一次基线查询、零写入。`@VersionColumn()` 提供
乐观锁，过期写入会抛 `OptimisticLockVersionMismatchError`。

```ts
await dataSource.transaction(async (manager) => {
  const repo = manager.getRepository(User)
  await repo.save(user)
  await manager.getRepository(Post).save(post)
}) // 回调返回即提交，抛出即回滚
```

## 模式同步与迁移

```ts
await dataSource.schemaLog()      // 只读差集，生产可安全执行
await dataSource.synchronize()    // 执行差集（危险开关）
await dataSource.runMigrations()  // 执行 pending 迁移
await dataSource.undoLastMigration()
```

迁移类名必须以 13 位时间戳结尾：

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

账本表默认 `migrations`，可用 `migrationsTableName` 覆盖。方言支持事务时，每条迁移
在自己的事务里执行，账本行与 DDL 同生共死。

## 薄入口

核心不依赖任何框架。适配器是独立子路径，只加载自己需要的那一层。

### DSH / Cordis

```ts
import * as ormPlugin from '@veren/orm/cordis'

ctx.plugin(ormPlugin, {
  dataSource,
  autoInitialize: true,
})

// 之后
const users = await ctx.verenOrm.getRepository(User).find()
await ctx.verenOrm.transaction(async (manager) => { /* ... */ })
```

插件注册 `ctx.verenOrm`，并把数据源生命周期挂到当前 fiber：卸载即销毁数据源、
释放全部连接。

文件式 Cordis Loader 条目请传声明式 `options`，不要传活的 `dataSource` 实例：
Loader 配置会做插值/序列化，而 `DataSource` 含有循环的运行时对象，无法往返。
实体类是值而不是 YAML，需要在宿主里先 import/注册，或者用 `ctx.plugin` 以代码
方式组合并直接传 `dataSource`。

### Hono

```ts
import { createHonoOrmMiddleware, getHonoOrm } from '@veren/orm/hono'

app.use('*', createHonoOrmMiddleware(dataSource, { transaction: true }))
app.get('/users', async (c) => c.json(await getHonoOrm(c).getRepository(User).find()))
```

响应状态码小于 400 时提交，否则回滚，连接必定归还。

### Express

```ts
import { createExpressOrmMiddleware, getExpressOrm } from '@veren/orm/express'

app.use(createExpressOrmMiddleware(dataSource))
app.get('/users', async (req, res) => {
  res.json(await getExpressOrm(req).getRepository(User).find())
})
```

`finish` 时按状态码提交/回滚，`close` 或抛错时回滚，连接只归还一次。

## 数据库可移植性

同一份实体与仓储代码可以跑 SQLite、PostgreSQL、MySQL；切换时只改
`DataSource` 配置（`type` 与 `url`/`filename`），查询、关系、持久化代码不变。
契约由 `tests/portability.spec.ts`（SQL/DDL 矩阵）和
`tests/portability.e2e.ts`（三种真库跑同一场景）守护。

| 领域 | 契约 |
| --- | --- |
| 标识符 / 占位符 | 方言负责：`"x"`/`?`、`"x"`/`$n`、`` `x` ``/`?` |
| 布尔 | 接受 `true/false` 或 `0/1`；PG 写 `boolean`，其余写 `0/1`；读回统一为 `boolean` |
| `date` | 接受 `Date` 或 ISO 日期字符串；日历日，统一存 `YYYY-MM-DD`，读回 UTC 午夜的 `Date` |
| `datetime`/`timestamp` | 接受 `Date` 或 ISO 字符串；UTC 时刻；SQLite ISO 文本、PG `timestamptz`、MySQL `datetime(3)`，读回 `Date` |
| `decimal` | 读回去掉尾零的规范字符串（`12.50` → `12.5`） |
| `bigint` | 读回字符串；超出 JS 安全整数范围时，SQLite 需改用文本列 |
| `json` / `simple-json` | 对象往返；SQLite 存文本，PG/MySQL 用原生 JSON |
| `simple-array` | `string[]`；元素内含逗号无法表示 |
| `blob` | 三种方言都读回 `Uint8Array` |
| 生成主键 | PG/SQLite 用 `RETURNING`；MySQL 多行插入自动拆成逐行，拿到不同 `insertId` |
| 数据库默认值 | 由库应用，但 `save` 后不会在任一方言回写到实体；需要时重新查询 |
| `=` / `IN` | 三种方言都大小写敏感（MySQL 字符串列用 `utf8mb4_bin`） |
| `Like` / `ILike` | 三种方言都大小写不敏感 |
| `ORDER BY` | 三种方言都 NULL 排最后（MySQL 用 `IS NULL` 模拟） |
| 分页 | 只有 offset、limit+offset 都按方言归一 |

原生 SQL 片段、数据库专属函数、`GROUP BY` 里选择未分组列、事务内执行 MySQL
DDL 仍不可移植：前两项由调用方负责，第三项在 PG/MySQL 会失败，第四项 MySQL
会隐式提交。此契约生效前已建的 MySQL 表仍用旧 collation，需要迁移重建。

## 扩展数据库方言

一个驱动由两块独立能力组成：

1. **方言**：纯 SQL/值策略——`values`（布尔/日期/JSON/decimal/blob）、
   `query`（排序/分页）、`schema`（列/主键/默认值/迁移账本）、转义、占位符、
   事务语句。
2. **Catalog**：由 `Driver` 持有的只读结构内省。

核心不判断数据库名，只调用这些策略与 `DriverCapabilities`
（`returning`、`multiRowGeneratedIds`、`ddlTransactions`、`transactions`、
`savepoints`、`uuidGeneration`）。

```ts
import {
  BaseDriver,
  BaseSchemaSyntax,
  ConfigurableValueCodec,
  StandardQuerySyntax,
  STANDARD_RULES,
  registerDriver,
  singleClientPool,
  type Catalog,
  type ColumnMetadata,
  type SqlDialect,
} from '@veren/orm'

class MyDialect implements SqlDialect {
  readonly name = 'my-db'
  readonly values = new ConfigurableValueCodec(STANDARD_RULES)
  readonly query = new StandardQuerySyntax()
  readonly schema = new BaseSchemaSyntax(this)
  readonly capabilities = {
    returning: true,
    multiRowGeneratedIds: true,
    ddlTransactions: true,
    uuidGeneration: true,
    transactions: true,
    savepoints: true,
  }
  readonly commitStatement = 'COMMIT'
  readonly rollbackStatement = 'ROLLBACK'
  readonly nowExpression = 'CURRENT_TIMESTAMP'
  escape(identifier: string): string { return `"${identifier}"` }
  createParameter(position: number): string { return `$${position}` }
  mapColumnType(column: ColumnMetadata): string { return 'TEXT' }
  beginStatements(): string[] { return ['BEGIN'] }
  supportsType(): boolean { return true }
}

class MyCatalog implements Catalog {
  async listTables(runner) { /* SELECT ... */ return [] }
  async listColumns(runner, table) { /* SELECT ... */ return [] }
}

registerDriver({
  type: 'my-db',
  create: (options) => new BaseDriver(
    new MyDialect(),
    options,
    async () => singleClientPool(await openMyConnection(options)),
    new MyCatalog(),
  ),
})
```

只有驱动自己的策略知道特殊语法；上层实体、仓储、查询都不变。
`tests/architecture.spec.ts` 会阻止数据库名分支重新回到核心。

## 错误与日志

所有失败都是带稳定 `code` 的 `OrmError` 子类：`QUERY_FAILED`、
`MISSING_PRIMARY_COLUMN`、`EMPTY_CRITERIA`、`OPTIMISTIC_LOCK_MISMATCH`、
`MISSING_DRIVER` 等。SQL 失败保留原始驱动错误（`driverError`）以及 `query`、
`parameters`，绝不裸抛驱动异常。

日志默认关闭。用 `logging: true | 'all' | ['query', 'error']` 打开，或注入自定义
`Logger` 实例。

## 当前限制（v0.1）

- 暂不支持嵌入对象、继承与树仓储。
- 多对多关系暂不支持手动 `innerJoin` / `leftJoin`，请用 `relations` 装载。
- `schemaLog` 只比较表是否存在、补缺失列；不会删除列或索引。
- 暂无 CLI 包与查询结果缓存。
- PostgreSQL 与 MySQL 的 SQL 生成有单测；真实数据库用例为可选（`pnpm test:e2e`
  配 `ORM_POSTGRES_URL` / `ORM_MYSQL_URL`），无凭据时自动跳过。

## 脚本

```bash
pnpm build       # tsc → dist
pnpm test        # vitest 单测 + 进程内集成（SQLite、Hono、Express、Cordis Loader）
pnpm test:e2e    # 真实数据库；无凭据的用例自动跳过
pnpm coverage    # vitest + V8 覆盖率（HTML 在 coverage/，Markdown 报告在 coverage-report.md）
pnpm typecheck   # tsc --noEmit
```

PostgreSQL/MySQL 真库用例读取 `ORM_POSTGRES_URL` 与 `ORM_MYSQL_URL`：

```bash
ORM_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/db pnpm test:e2e
ORM_MYSQL_URL=mysql://user:pass@127.0.0.1:3306/db pnpm test:e2e
```

## 许可证

MIT
