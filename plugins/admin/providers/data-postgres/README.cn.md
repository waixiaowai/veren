# @veren/admin-data-postgres

DSH 后台平台推荐的生产 `data` provider。它基于 PostgreSQL 实现
`@veren/admin-contract` 的 `AdminDatabase`，并向内核注册；因此所有消费方仍只面对稳定的
`ctx.adminData` façade，看不到数据库。

需要持久、并发、事务性存储以及由运维管理的 PostgreSQL 时使用它。嵌入式或零配置部署请
继续使用 `@veren/admin-data-dsh-kv`（DSH 存储域，JSON/SQLite 介质）。

## 提供什么

- `src/adapter.ts` 中的 `AdminDatabase`（`table`、`transaction`、`health`、
  `features`）。
- `src/schema.ts` 声明的 `veren_` 前缀表，由幂等的启动引导创建。
- `src/store.ts` 中的 SQL 传输与事务处理，`pg` 由 `src/plugin.ts` 独占。
- provider 声明 `{ id: 'postgres', capability: 'data', contract: '^1.0',
  priority: 10, dataDomain: 'veren_admin' }`。优先级 10 高于 KV 回退（0），因此两行
  同时启用时由 PostgreSQL 提供 `data`。
- `features = { transactions: true, secondaryIndexes: false, fullText: false }`。
  事务是真实的。`secondaryIndexes` 保持 `false`，因为端口没有临时查询面：下列索引服务
  运维人员与未来的 SQL 消费方，而不是面向模块的查询面。

## 表与索引

每张平台表都有 `id text PRIMARY KEY`、`data jsonb NOT NULL`（完整记录，原样往返）以及
为值得索引的字段准备的可空投影列。投影列可空，是因为端口只校验 `id`；缺失字段绝不能把
一次 KV 兼容的写入变成约束错误。

| 表 | 集合 | 投影列 | 索引 |
|---|---|---|---|
| `veren_users` | `admin_users` | `email`、`name`、`active`、`password_hash`、`created_at`、`last_login_at` | 唯一 `(lower(email))`、`(active)`、`(created_at DESC)` |
| `veren_sessions` | `admin_sessions` | `user_id`、`token_hash`、`created_at`、`expires_at`、`last_seen_at` | 唯一 `(token_hash)`、`(user_id)`、`(expires_at)` |
| `veren_tokens` | `admin_tokens` | `user_id`、`name`、`prefix`、`secret_hash`、`scopes text[]`、`created_at`、`last_used_at`、`revoked_at` | 唯一 `(secret_hash)`、`(user_id)`、`(prefix)` |
| `veren_roles` | `admin_roles` | `label`、`permissions text[]`、`created_at` | `(created_at DESC)` |
| `veren_bindings` | `admin_bindings` | `user_id`、`role_id`、`created_at` | 唯一 `(user_id, role_id)`、`(role_id)` |
| `veren_audit` | `admin_audit` | `at`、`actor_id`、`actor_label`、`action`、`result`、`target`、`request_id`、`ip`、`detail jsonb` | `(at DESC)`、`(actor_id, at DESC)`、`(action)`、`(result)` |
| `veren_records` | 其他任意集合 | `collection`、`id`、`data` | 主键 `(collection, id)`、`(collection)` |

索引名遵循 `<表>_<用途>`：`veren_users_email_key`、
`veren_sessions_token_hash_key`、`veren_tokens_secret_hash_key`、
`veren_bindings_user_role_key`、`veren_audit_at_idx` 等。

## 配置

连接值来自 profile 配置，绝不写死在代码里：

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

| 字段 | 默认值 | 含义 |
|---|---|---|
| `host` | `127.0.0.1` | PostgreSQL 主机 |
| `port` | `5432` | PostgreSQL 端口 |
| `user` | `veren` | 登录角色 |
| `password` | `''` | 登录口令；优先用 `!!js process.env.*` 而非字面量 |
| `database` | `veren_admin` | 数据库名；必须已存在 |
| `schema` | `public` | 承载表的 schema；缺失时创建 |
| `ssl` | `false` | 要求 TLS 并校验证书 |
| `maxConnections` | `10` | 连接池上限 |
| `connectTimeoutMs` | `10000` | 连接尝试超时 |
| `migrateOnBoot` | `true` | 加载时执行幂等引导 |

连接池把 `search_path` 固定为 `schema`，因此与登录角色同名的 schema 不会截获 `veren_`
表。schema 不存在时角色需要对数据库有 `CREATE` 权限；目标 schema 上需要普通建表/建索引
权限。

## Schema 引导：自动且幂等

插件在加载时于一个事务内引导 schema，并用 `pg_advisory_xact_lock` 串行化：

1. 配置的 schema 缺失时 `CREATE SCHEMA`（先查 `pg_namespace`，因此重复部署不需要数据库级
   `CREATE` 权限）。
2. 每张表的 `CREATE TABLE IF NOT EXISTS`。
3. 每个投影列的 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。
4. 每个索引的 `CREATE [UNIQUE] INDEX IF NOT EXISTS`。

取舍：自动引导省去单独部署步骤，新装只需一条命令即可工作。代价是引导**只做增量**——
只补缺失的表和列，绝不改名、改类型或删除，也不保留已应用版本历史。破坏性演进仍需手工
迁移。需要更严格的变更管理时，设 `migrateOnBoot: false`，在部署任务中调用导出的
`ensureSchema(pool, schema)`；插件运行的就是同一个函数。引导失败会让插件加载失败，绝不
提供半迁移的 schema。

## 读模型与事务

端口读取是同步的，因此适配器维护写穿镜像：

- 启动时 `loadAll()` 一次并填充镜像。
- 写入先到达 PostgreSQL；数据库接受后镜像才变化。失败的写入绝不会让记录可见。
- `find`、`list`、`size` 由内存作答。内存成本与存储记录总数成正比；这是后台规模存储，
  不是分析仓库。
- 镜像是进程内的。**一个数据库只支持一个写进程**：第二个共享同一批表的 DSH 进程会保留
  过期镜像，直到重启。

`transaction(work)` 独占一条连接，执行 `BEGIN`，把事务绑定工作单元交给回调，然后
`COMMIT` 并把待定变更并入镜像。事务内的工作通过 overlay 读到自己的未提交写入；事务外的
读取仍看到已提交数据。回调抛出时回滚并丢弃 overlay。事务之间由内部队列串行。事务外发起
的写入不受该队列串行化（单条语句仍按序落库）。

## 切回 JSON 后端

`@veren/admin-app` 默认启用 PostgreSQL，并随包提供禁用的 DSH KV 行。禁用 PostgreSQL 行、
启用 KV 行，并确保 profile 含有 `storage` 与 `storageDomain`：

```yaml
- id: admin-data-postgres
  disabled: true
- id: admin-data-dsh-kv
  disabled: false
  config:
    storage:
      backend: json
```

KV 适配器现在把两个键段编码为十六进制并用 `_` 连接，因此 JSON 后端的 per-record
path-safe 规则（`/^[a-zA-Z0-9_-]+$/`）接受任意集合名与 id，包括 `:`、`/`、`.` 与非 ASCII
文本。两个 provider 暴露同一个 `ctx.adminData` 端口，消费方代码无需改动。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/data-postgres
```

单测覆盖：假记录存储上的适配器（镜像装载、CRUD、写穿顺序、事务隔离/回滚/串行化、健康）、
SQL 绑定与幂等 DDL、store 的事务边界，以及用记录型连接池驱动的插件注册/卸载。

集成测试使用真实服务器，未设置 URL 时自动跳过：

```powershell
$env:VEREN_PG_TEST_URL = 'postgres://veren:veren@127.0.0.1:5432/veren_admin'
pnpm exec vitest run --root plugins/admin/providers/data-postgres
```

它会创建一次性 schema，校验 DDL 足迹，往返全部平台集合与回退表，并检查事务提交与回滚，
结束后删除该 schema。目标数据库与登录必须已存在。

## 已知限制

- **进程内镜像。** 没有跨进程失效；一个数据库只支持一个写进程。
- **只做增量引导。** 没有向下迁移、版本历史或破坏性 schema 变更。
- **没有临时查询端口。** 模块仍通过 `list()` 读取整个集合；SQL 索引服务运维与未来的 SQL
  消费方。
- **没有全文检索。**
- **同一时刻一个事务。** 事务串行化，以保证确定的加锁顺序与受控的连接池占用。
- **未知集合进入回退表。** 只有六个平台集合有专用表；新集合在新增专用 schema 前写入
  `veren_records`。
- **不迁移 KV 数据。** 在 provider 之间搬移既有记录是运维任务。
