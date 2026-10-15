# 设计文档：基于 DSH Domain Storage 的 Kysely Dialect（用于 Better Auth）

- 状态：**已实现** —— `packages/kysely-dsh-dialect`（`@veren/kysely-dsh-dialect`），
  已在 `plugins/auth` 接线；见文末"落地备注"
- 范围：新建独立工具库包 `packages/kysely-dsh-dialect`（`@veren/kysely-dsh-dialect`）；
  `plugins/auth`（`@veren/web-login-gate`）仅作为消费方
- 相关代码：`plugins/auth/src/adapter.ts`（现手写 `DBAdapter`）、`plugins/auth/src/auth.ts`
- 验证基线：`kysely@0.29.6`、`better-auth@1.7.8`（自带 `@better-auth/kysely-adapter`）
- 英文版：[README](./better-auth-kysely-dialect.md)

## 1. 动机

当前适配器（`plugins/auth/src/adapter.ts`）直接实现 Better Auth 的底层 `DBAdapter`
接口：8 个 CRUD 操作、手写 `where` 语义（AND/OR 分组、10 种操作符、insensitive 模式）、
排序、分页、`select` 投影——约 220 行正确性完全由我们自己负责的逻辑。

Better Auth 官方已维护一个 Kysely 适配器（`kyselyAdapter(db: Kysely<any>, config)`）。
只要能把 DSH domain storage 暴露成 Kysely 的"数据库"，全部查询语义就由 Kysely 编译，
手写逻辑即可删除。

## 2. 已验证事实

1. **`@better-auth/kysely-adapter` 是 better-auth 1.7.8 的公开 API。** 类型声明中的签名：
   ```ts
   kyselyAdapter(db: Kysely<any>, config?: {
     type?: 'postgres' | 'mysql' | 'sqlite' | 'mssql'
     transaction?: boolean      // 默认 false
     usePlural?: boolean        // 默认 false
     debugLogs?: DBAdapterDebugLogOption
   })
   ```
2. **Kysely `Dialect` 就是四个工厂**（v0.29.6 `dist/dialect/dialect.d.ts`）：
   `createDriver()`、`createQueryCompiler()`、`createAdapter()`、`createIntrospector(db)`。
3. **`Driver` 拿到的是编译结果而非 AST。** 执行钩子是
   `DatabaseConnection.executeQuery<T>(compiledQuery: CompiledQuery)`；
   `CompiledQuery` 为 `{ sql: string, parameters: readonly unknown[], query, queryId }`，
   契约并不要求 `sql` 是 SQL 文本。
4. **`DatabaseIntrospector` 只需 `getSchemas()` 与 `getTables()`。** Better Auth 的
   schema 校验（`diffSchema`）消费该元数据，因此正确的 introspector 还能打通
   Better Auth 的 schema 比对与迁移工具链——现有自定义 `DBAdapter` 无法参与。

## 3. 核心设计

关键手法：**自定义 `QueryCompiler` 把 Kysely 的 operation-node 树序列化为结构化 JSON
指令，放入 `CompiledQuery.sql` 字段**；`Driver` 解析该指令并映射到 `KvTable` 操作。
社区为非 SQL 后端（Cloudflare D1、S3 Select 等）编写 dialect 时用的正是这条路——
走 Kysely 官方扩展面，而非 hack。

### 3.1 指令格式（编译进 `sql`）

```jsonc
{
  "v": 1,                          // 指令格式版本
  "op": "select",                  // select | insert | update | delete
  "from": "user",                  // 逻辑表 == KvTable 名
  "columns": ["id", "email"],      // 投影（仅 select）
  "where": [                       // AND/OR 树，由编译器预先展平
    { "connector": "AND", "field": "email", "cmp": "eq", "value": "..." },
    { "connector": "OR",  "expr": [ /* 嵌套组 */ ] }
  ],
  "values": { "id": "...", "email": "..." },  // insert/update 载荷
  "orderBy": [{ "field": "createdAt", "dir": "desc" }],
  "limit": 10, "offset": 0,
  "returning": ["id"]
}
```

所有值随 JSON 文档整体传递；`parameters` 保持为空。查询因此天然原子，也避免
位置参数重绑定一类 bug。

### 3.2 执行映射

| Kysely 操作 | Domain storage 操作 |
|---|---|
| `select` | `table.entries()` → 过滤（`where`）→ 排序（`orderBy`）→ 切片（`offset/limit`）→ 投影（`columns`） |
| `insert` | `table.put('<model>:<id>', row)` |
| `update` | 扫描 + 匹配 → `table.put(key, { ...row, ...values })` |
| `delete` | 扫描 + 匹配 → `table.delete(key)` |

读是同步内存命中；写经 domain 的单一持久写链——与现有 adapter 完全一致。介质
（json/sqlite）仍由 storage group 为 `web-login-gate` domain 的路由决定。

### 3.3 包布局（满足单文件 300 行、单一职责规范）

dialect 是**独立可复用工具库包**——只依赖 `kysely` 与 `@deepseek-ai/dsh-storage-domain`
的 `KvTable` 面，对 Better Auth 和 login gate 零感知；Better Auth 接线留在插件内。

```
packages/kysely-dsh-dialect/
├── package.json          # @veren/kysely-dsh-dialect；依赖：kysely、@deepseek-ai/dsh-storage-domain
├── src/
│   ├── dialect.ts        # 装配四个工厂；约 40 行
│   ├── compiler.ts       # QueryCompiler：遍历 operation-node 树 → 指令 JSON；约 200 行
│   ├── executor.ts       # 指令 → KvTable 操作 + 内存过滤/排序/分页；约 180 行
│   ├── driver.ts         # Driver + 单一 DatabaseConnection；事务钩子为 no-op；约 90 行
│   ├── introspector.ts   # 暴露已声明表元数据；约 60 行
│   └── index.ts          # 导出 DomainStorageDialect + 在 domain 上打开 Kysely 的辅助函数
├── tests/                # vitest 单测（不依赖 Better Auth）
├── README.md / README.cn.md
└── tsconfig.json
```

### 3.4 Dialect 能力声明

- `createAdapter()`：采用 Sqlite 风格能力——`supportsTransactionalDdl: false`、
  `supportsCreateIfNotExists: true`、`supportsReturning: false`。
- 事务：`Driver.beginTransaction/commit/rollback` 为 no-op；Better Auth 侧传
  `transaction: false`，操作顺序执行（与现状相同）。
- 日期：继续存 ISO 字符串（KvTable JSON 介质）；Kysely DB 类型声明为字符串时间戳，
  运行期零日期转换。

### 3.5 `auth.ts` 接线变更

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

`type: 'sqlite'` 语义上与 domain storage 最贴合：动态类型值、无服务端事务。

## 4. 收益

- 删除约 220 行手写查询语义；where/排序/分页的正确性交给 Kysely 编译器与运行时。
- 借助 introspector，Better Auth 的 schema 校验（`diffSchema`）与 CLI 迁移路径变为
  可用——现有自定义 `DBAdapter` 无法参与这些路径。
- dialect 对任意 DSH storage domain 通用：未来任何"Kysely 跑在 DSH domain 上"的
  消费者都能复用，不止 Better Auth。作为独立包，它独立版本、独立测试，可被任何
  应用或插件复用——不携带任何 Better Auth 或 login gate 耦合。

## 5. 风险与待决问题

1. **编译器覆盖面。** Kysely 的 operation-node 树很大。范围收窄：只支持 Better Auth
   的 Kysely 适配器实际会发出的节点种类（select/insert/update/delete、where 比较、
   orderBy、limit/offset、returning）。未知节点必须显式失败并带稳定错误码
   （如 `DIALECT_NODE_UNSUPPORTED`）。
2. **Schema 校验严格度。** `diffSchema` 可能要求列元数据保真；introspector 初期把
   列报成动态类型（`dataType: 'any'`）。若 Better Auth 产生误报，可能需要从其声明的
   schema 播种列元数据。
3. **新增直接依赖。** `kysely` 加入 `packages/kysely-dsh-dialect/package.json`
   （目前只是传递依赖）。固定为 better-auth 解析出的版本（`0.29.6`），避免双实例
   类型不匹配；`plugins/auth` 此后依赖 `@veren/kysely-dsh-dialect`，不再直接依赖
   `kysely`。
4. **`update` 影响行数。** Better Auth 部分路径依赖受影响行数（其适配器文档中的
   MySQL `FOUND_ROWS` 说明即为此），执行器必须在每个 `update`/`delete` 上准确返回
   `numChangedRows`/`numAffectedRows`。

## 6. 工作量估计

含双语注释与单测约 550–650 行，分布在包的六个源文件，外加
`packages/kysely-dsh-dialect/tests/*.spec.ts`（往返用例：insert → where 查询 →
update → delete，以及指令编译器对不支持节点的失败快照测试）。插件侧改动仅是
`plugins/auth/src/auth.ts` 几行接线加一处 `package.json` 依赖替换。

## 7. 落地备注（与提案的差异）

1. **导入路径。** `better-auth/adapters/kysely-adapter` 不在 better-auth 公开
   `exports` 中；插件直接依赖已发布的 `@better-auth/kysely-adapter@1.7.8`。
2. **源文件数量。** 包保持五个源文件（`types`、`compiler`、`executor`、`dialect`、
   `index`）——driver 与 dialect-adapter 装配合并在 `dialect.ts`。
3. **Schema 校验。** 风险 #2 的解法是关闭 Better Auth 面向 SQL 的列比对
   （`advanced.database.validateSchema: false`）：domain 存储本就是宽松 schema，
   介质版本由 domain spec 管理，列级精确比对不适用。introspector 仍可供 Kysely
   工具链使用。
4. **从 better-auth 实际查询形态学到的编译细节：** 每个 select 都包一层子查询
   （`select * from (<inner>) as primary`），需要展平；大小写不敏感比较编译为
   `lower(col) like lower(?)`，映射为 `ilike`；insert 单元格值可能是原始值或
   `ValueNode`。update/delete 结果必须填 `numAffectedRows`（Kysely 将其映射为
   `numUpdatedRows`）。
5. **依赖固定。** 包内 `kysely` 固定为 `0.29.6`（与 better-auth 的解析一致）。
