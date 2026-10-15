# @veren/kysely-dsh-dialect

一个 Kysely `Dialect`，让类型安全查询直接跑在 DSH storage domain 的 `KvTable`
上。适用于 Kysely——或构建其上的 Better Auth `kyselyAdapter`——需要读写 DSH
storage domain 中记录的场景。后端是真实 SQL 数据库时不要用它：官方 Kysely
dialect 更简单也更快。

## 工作原理

- `createQueryCompiler` 把 Kysely 的 operation-node 树序列化为 JSON 指令，放在
  `CompiledQuery.sql` 中传输（`parameters` 保持为空）。
- `createDriver` 暴露单一连接，其 `executeQuery` 解析指令并映射到 `KvTable`
  操作：读扫描同步内存快照；写排入 domain 的单一持久写链。
- 事务为 no-op（写链已把变更串行化）；能力标志如实声明
  （`supportsTransactionalDdl: false`、`supportsMultipleConnections: false`）。
- 不受支持的形态（join、upsert、聚合）以稳定 `DialectError.code` 显式失败，
  如 `DIALECT_NODE_UNSUPPORTED`。

## 用法

```ts
import { kyselyAdapter } from 'better-auth/adapters/kysely-adapter'
import { openDomainKysely } from '@veren/kysely-dsh-dialect'

const db = openDomainKysely(domain, ['user', 'session', 'account', 'verification'])

betterAuth({
  database: kyselyAdapter(db, { type: 'sqlite', transaction: false }),
})
```

或直接用 Kysely：

```ts
const rows = await db.selectFrom('user').selectAll().where('email', '=', 'a@b.c').execute()
```

domain 生命周期归调用方（`domain.close()`）；dialect 绝不打开或关闭 domain。

## 约束

- 仅支持单表 CRUD：`select` / `insert` / `update` / `delete`，带 where 比较、
  `in` 列表、LIKE/ILIKE、order-by、limit/offset、returning。
- insert 必须带字符串 `id`；存储键为 `<table>:<id>`。
- 不支持 join、聚合、CTE、upsert、schema DDL。

完整设计见 `docs/designer/better-auth-kysely-dialect.md`。
English docs: [README.md](./README.md)
