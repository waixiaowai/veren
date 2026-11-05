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

## 扩展数据库方言

两层可以独立扩展：

1. **方言**：转义、占位符、类型映射、事务语句。
2. **环境桥**：知道如何与具体驱动通信的 `SqlClient`。

注册一次，之后按 `type` 名引用：

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

核心没有任何 `if (type === 'postgres')` 分支；驱动之上的判断全部走
`DriverCapabilities`（返回列、事务、保存点、UUID 生成）。

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
- PostgreSQL 与 MySQL 的 SQL 生成有单测；真实数据库用例为可选，不在默认测试套件里。

## 脚本

```bash
pnpm build       # tsc → dist
pnpm test        # vitest
pnpm coverage    # vitest + V8 覆盖率（HTML 在 coverage/）
pnpm typecheck   # tsc --noEmit
```

## 许可证

MIT
