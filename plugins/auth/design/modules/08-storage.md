---
title: 存储域
description: 以统一适配契约读写数据并保证一致性语义，不解释业务字段含义。
sidebar:
  order: 10
  label: 存储域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 8. Persistence

存储域负责把「模型名 + 字段名 + 条件」这一组读写意图，落到宿主提供的持久化存储上，并保证每次读写具备可依赖的一致性语义。与相邻模块的分界是：它只按模型名与字段名读写并保证原子性，**不解释业务字段含义**——「被禁用」是什么意思、「已验证」如何判定，都不是本域的事。

本域是**核心域**。理由见 [核心业务识别](../architecture/#14-core-business-identification)：所有状态的落地必经此域，存储失效则全部状态不可持久；它命中「事实权威」判据，因此即便砍掉其余能力，仅留存储域与最小入口仍是一套完整的数据存取系统。

### 8.0 Key Decisions

**决策 1 — 更新失败即失败**

- 决策：单行更新命中零行时必须返回 `null`，绝不能返回「成功」或旧值；空条件谓词一律拒绝执行。
- 理由：`update` 的语义是「按条件改一行并把改后的行给我」，调用方据此判断状态迁移是否真的发生。如果零行命中也返回成功，调用方会把一次没有生效的状态迁移当成已生效——撤销、过期、状态流转都会静默失效。契约见 `packages/core/src/db/adapter/index.ts:440-454`（`update` 返回 `T | null`，「Returns the updated row, or `null` when no row matched. Empty `where` clauses return `null`」），工厂层的空谓词短路见 `packages/core/src/db/adapter/factory.ts:988-992`。
- 违反后果：状态机出现「幽灵迁移」——数据库没变，框架认为变了；后续所有基于该状态的判断都建立在错误前提上，且这类缺陷只在并发或竞态条件下显形。

**决策 2 — 原子消费**

- 决策：一次性凭据的核销必须是原子的，且只允许一行被消费；并发调用下只有一方拿到凭据，其余拿到 `null`。适配器缺少原生能力时，工厂用「快照守卫」降级实现，并要求受影响行数恰为 0 或 1。
- 理由：邮件验证码、授权码、一次性令牌被重复核销，等价于凭据被复制。契约见 `packages/core/src/db/adapter/index.ts:462-477`，降级实现见 `packages/core/src/db/adapter/atomic-fallback.ts:157-176`，行数校验见 `atomic-fallback.ts:148-155`。
- 违反后果：同一验证码可被并发使用多次，攻击者可在受害者之前完成核销，账号被接管。

**决策 3 — 原子增量以条件为守卫**

- 决策：计数器的增减必须用 `where` 同时充当选择器与守卫——比较型操作符被真实下推到存储层；守卫未命中任何行时不做任何修改并返回 `null`。
- 理由：「剩余次数减一」这类操作如果先读后写，两个并发请求都会读到同一个正数并都通过检查。契约见 `packages/core/src/db/adapter/index.ts:478-508`。适配器无原生能力时，工厂用有界 CAS 重试；竞争耗尽时**抛错**而不是返回 `null`（`atomic-fallback.ts:198-244`）。
- 违反后果：限流配额、剩余额度一类「剩余量」被超发；静默返回 `null` 会让调用方误判为「本来就满了」，掩盖真实故障。

**决策 4 — 表模型合并顺序确定**

- 决策：核心表与插件表的合并顺序固定且可预测——插件按声明顺序合并，同名字段后者覆盖前者；索引按定义去重合并；表模型名可被改写；插件可用 `disableMigration` 声明某张表不参与迁移。
- 理由：同一份配置在任意机器、任意时刻必须解析出同一张表结构，否则迁移脚本与运行时读写会指向不同的列。合并实现见 `packages/core/src/db/get-tables.ts:29-57`（插件归并）与 `get-tables.ts:197-347`（核心表装配）。
- 违反后果：迁移产物与运行时模型不一致，表现为「列不存在」或「写进了另一列」；且问题只在插件组合变化时出现。

**决策 5 — 存储域不解释业务**

- 决策：存储域只认模型名、字段名、条件与原子性语义。它不判断字段值意味着什么，也不因为业务含义而改变读写行为。
- 理由：一旦存储层开始解释业务（例如「`disabled` 为真时不许更新」），同一张表在不同业务路径下就会出现不同的一致性语义，原子性保证将不再可推理。字段语义由[身份域](./05-identity/)、[会话域](./03-session/)、[守卫域](./07-guard/)定义，参见 [总体方案与架构](../architecture/#13-dependency-direction)。
- 违反后果：数据平面与业务平面耦合，核心域的原子性推理失效；跨表事务与守卫逻辑被迫下沉。

### 8.1 Responsibility Boundary

本域承担五件事：

1. **模型装配**：产出「模型名 → 物理表名 / 字段名 → 物理列名 / 字段属性」的映射，并把核心表与插件贡献的表合并为一份模型定义。
2. **契约包装**：把宿主提供的原生适配器包装成统一的 `DBAdapter` 契约面（`create`/`findOne`/`findMany`/`count`/`update`/`updateMany`/`delete`/`deleteMany`/`consumeOne`/`incrementOne`/`transaction`），并统一施加名称映射、字段变换与条件规范化。
3. **一致性保证**：为「单行更新」「一次性消费」「带守卫的增量」三类操作提供确定语义，无论底层是否原生支持。
4. **事务边界**：提供 `transaction` 入口；不支持事务的存储退化为顺序执行。
5. **二级存储契约**：为会话、限流计数与校验凭据提供一套与主库解耦的键值存储接口。

本域明确**不做**的事：

- 不解释字段的业务含义（决策 5）。
- 不决定「能不能改这条记录」——那是身份域与守卫域基于主体状态做出的判断。
- 不负责迁移脚本的生成决策（[命令行域](./11-cli/)），但提供表模型与索引定义作为迁移输入。
- 不持有会话状态的有效期语义（会话域）。

### 8.2 Capability Inventory

**适配契约**

- `create`：写入一行，`data.id` 默认被忽略，`forceAllowId` 为真时强制采用调用方给定的 `id`（`packages/core/src/db/adapter/index.ts:405-415`）。
- `findOne` / `findMany` / `count`：读，支持 `where`、`select`、`limit`、`offset`、`sortBy`、`join`。
- `update`：单行更新，命中零行返回 `null`（决策 1）。
- `updateMany`：批量更新，返回受影响行数，必须是有限数值，否则抛错（`packages/core/src/db/adapter/factory.ts:1095-1102`）。
- `delete` / `deleteMany`：删除单行与批量删除。
- `consumeOne`：原子消费单行，删除并返回被删行；并发下只有一方拿到行（决策 2）。
- `incrementOne`：原子带守卫增量；`where` 既是选择器也是守卫；可选 `set` 在同一原子操作内赋绝对值（决策 3）。
- `transaction`：在事务内执行回调；适配器可能因瞬时错误多次执行回调，因此事务外的副作用必须放进 `queueAfterTransactionHook`（`packages/core/src/db/adapter/index.ts:509-519`）。
- `createSchema?`：可选的建表产物生成入口，供 CLI 生成迁移文件。

**条件结构**

- `Where`：`operator`（默认 `eq`）、`value`、`field`、`connector`（默认 `AND`）、`mode`（默认 `sensitive`，可选 `insensitive` 仅作用于字符串比较）（`packages/core/src/db/adapter/index.ts:324-343`）。
- `whereOperators` 全 11 项：`eq`、`ne`、`lt`、`lte`、`gt`、`gte`、`in`、`not_in`、`contains`、`starts_with`、`ends_with`（`packages/core/src/db/adapter/index.ts:308-320`）。

**关联**

- `JoinOption` → `JoinConfig`：每个关联模型给出 `on.from`/`on.to` 连接列、`limit`（默认 100，唯一约束下强制为 1）、`relation`（`one-to-one` / `one-to-many` / `many-to-many`，默认 `one-to-many`）（`packages/core/src/db/adapter/index.ts:345-397`）。

**字段属性**

- `DBFieldAttribute` 的全部配置项：`type`、`required`（默认 `true`）、`returned`（默认 `true`）、`input`（默认 `true`）、`defaultValue`、`onUpdate`、`transform`（`input`/`output`）、`references`（`model`/`field`/`onDelete`，默认 `cascade`）、`unique`、`bigint`、`validator`（Standard Schema）、`fieldName`、`sortable`、`index`（默认 `false`）（`packages/core/src/db/type.ts:164-283`）。
- `DBTableIndex`：`fields`（1–16 个逻辑字段，按索引顺序）、`name`（至多 63 UTF-8 字节）、`unique`（`packages/core/src/db/type.ts:286-293`）。

**表模型**

- 核心五表：`user`、`account`、`session`、`verification`、`rateLimit`。其中 `session` 与 `verification` 在启用二级存储且未显式要求落库时**不生成**，`rateLimit` 仅在 `rateLimit.storage === "database"` 时生成（`packages/core/src/db/get-tables.ts:247-250,342-346`）。运行期使用的模型键是 `rateLimit`（`packages/better-auth/src/api/rate-limiter/index.ts:119`）；`ModelNames` 类型面另允许字面量 `rate-limit`（`packages/core/src/db/type.ts:11-14`）。
- 核心表的 `modelName` 与各列 `fieldName` 均可被宿主改写（`get-tables.ts:199,252,91,131`）。
- 外键引用一律使用规范模型键 `"user"` 而非 `modelName` 别名，避免别名撞车导致外键指向错表（`get-tables.ts:171-186`）。
- 插件表合并：按插件声明顺序归并，同名字段后者覆盖前者；索引按 `[name, fields, unique]` 定义去重；`modelName` 取插件声明值；`disableMigration` 从插件声明提升为表的 `disableMigrations`（`get-tables.ts:29-57`）。
- 索引解析：`resolveDatabaseSchemaIndexes` 依据方言（`mssql` / `mysql`）生成可移植的索引名（`packages/core/src/db/database-index.ts:101,250`）。

**主键生成**

- `initGetIdField` 决定主键字段形态：`generateId: "serial"` → `number` 类型；否则 `string`。生成责任依次为：宿主函数 → `"uuid"` → 适配器自定义生成器 → 框架默认生成器；`"serial"` 与 `false` 时交由数据库生成（`packages/core/src/db/adapter/get-id-field.ts:53-196`）。
- 单次性记录可用 `encodeDeterministicId` 把摘要编码成主键，实现「首次写入者获胜」；在 `"serial"` 策略下该保证失效并告警（`get-id-field.ts:28-51`）。

**二级存储契约**

- `get` / `getAndDelete` / `increment`（原子自增，返回自增后值，键不存在时以 `1` 创建并应用 `ttl` 秒，后续自增不延长 TTL）/ `set`（可带 `ttl` 秒）/ `delete`（`packages/core/src/db/type.ts:320-363`）。

**适配器实现包**

| 包 | 适配器 id | 展示名 | 原生 `consumeOne` / `incrementOne` |
|---|---|---|---|
| `packages/drizzle-adapter` | `drizzle` | Drizzle Adapter | 有（`drizzle-adapter.ts:1078,1130`） |
| `packages/prisma-adapter` | `prisma` | Prisma Adapter | 有（`prisma-adapter.ts:668,736`） |
| `packages/kysely-adapter` | `kysely` | Kysely Adapter | 有（`kysely-adapter.ts:859,940`） |
| `packages/mongo-adapter` | `mongodb-adapter` | MongoDB Adapter | 有（`mongodb-adapter.ts:753,761`） |
| `packages/memory-adapter` | `memory` | Memory Adapter | 有（`memory-adapter.ts:556,564`） |

**表结构校验**

- `checkSchema`（运行时校验）与 `explicitSchemaCheck`（显式校验）在装配末尾挂载；校验失败只记日志不阻断请求（`packages/better-auth/src/context/create-context.ts:440-441`、`packages/better-auth/src/auth/base.ts:27-36`）。

### 8.3 Contract

```ts
// 统一适配契约
// 来源：packages/core/src/db/adapter/index.ts:403-533
export type DBAdapter<Options extends BetterAuthOptions = BetterAuthOptions> = {
  id: string;
  create: <T extends Record<string, unknown>, R = T>(data: {
    model: string;
    data: Omit<T, "id">;
    select?: string[] | undefined;
    forceAllowId?: boolean | undefined;   // 为真时强制采用 data.id
  }) => Promise<R>;
  findOne: <T>(data: {
    model: string;
    where: Where[];
    select?: string[] | undefined;
    join?: JoinOption | undefined;
  }) => Promise<T | null>;
  findMany: <T>(data: {
    model: string;
    where?: Where[] | undefined;
    limit?: number | undefined;
    select?: string[] | undefined;
    sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
    offset?: number | undefined;
    join?: JoinOption | undefined;
  }) => Promise<T[]>;
  count: (data: { model: string; where?: Where[] | undefined }) => Promise<number>;
  /** 单行更新；命中零行返回 null；空 where 返回 null */
  update: <T>(data: {
    model: string;
    where: Where[];
    update: Record<string, unknown>;
  }) => Promise<T | null>;
  /** 批量更新；返回受影响行数，必须为有限数值 */
  updateMany: (data: {
    model: string;
    where: Where[];
    update: Record<string, unknown>;
  }) => Promise<number>;
  delete: <_T>(data: { model: string; where: Where[] }) => Promise<void>;
  deleteMany: (data: { model: string; where: Where[] }) => Promise<number>;
  /** 原子消费单行；并发下只有一方拿到行 */
  consumeOne: <T>(data: { model: string; where: Where[] }) => Promise<T | null>;
  /** 原子带守卫增量；where 兼作守卫；未命中返回 null */
  incrementOne: <T>(data: {
    model: string;
    where: Where[];
    increment: Record<string, number>;
    set?: Record<string, unknown> | undefined;
  }) => Promise<T | null>;
  transaction: <R>(
    callback: (trx: DBTransactionAdapter<Options>) => Promise<R>,
  ) => Promise<R>;
  createSchema?: ((options: Options, file?: string) => Promise<DBAdapterSchemaCreation>) | undefined;
  options?: ({ adapterConfig: DBAdapterFactoryConfig<Options> } & Record<string, unknown>) | undefined;
};

// 条件结构与操作符全集
// 来源：packages/core/src/db/adapter/index.ts:308-343
export const whereOperators = [
  "eq", "ne", "lt", "lte", "gt", "gte", "in", "not_in",
  "contains", "starts_with", "ends_with",
] as const;

export type WhereOperator = (typeof whereOperators)[number];

export type Where = {
  operator?: WhereOperator | undefined;   // 默认 eq
  value: string | number | boolean | string[] | number[] | Date | null;
  field: string;
  connector?: ("AND" | "OR") | undefined;  // 默认 AND
  mode?: ("sensitive" | "insensitive") | undefined;  // 默认 sensitive
};

// 关联配置
// 来源：packages/core/src/db/adapter/index.ts:359-397
export type JoinConfig = {
  [model: string]: {
    modelKey?: string | undefined;
    on: { from: string; to: string };
    limit?: number | undefined;    // 默认 100，唯一约束下强制为 1
    relation?: ("one-to-one" | "one-to-many" | "many-to-many") | undefined;  // 默认 one-to-many
  };
};

// 字段属性
// 来源：packages/core/src/db/type.ts:164-283
export type DBFieldType =
  | "string" | "number" | "boolean" | "date" | "json"
  | `${"string" | "number"}[]`
  | Array<LiteralString>;

export type DBFieldAttributeConfig = {
  required?: boolean | undefined;        // 默认 true
  returned?: boolean | undefined;        // 默认 true
  input?: boolean | undefined;           // 默认 true
  defaultValue?: (DBPrimitive | (() => DBPrimitive)) | undefined;
  onUpdate?: (() => DBPrimitive) | undefined;
  transform?: {
    input?: (value: DBPrimitive) => Awaitable<DBPrimitive>;
    output?: (value: DBPrimitive) => Awaitable<DBPrimitive>;
  } | undefined;
  references?: {
    model: string;
    field: string;
    onDelete?: ("no action" | "restrict" | "cascade" | "set null" | "set default") | undefined;  // 默认 cascade
  } | undefined;
  unique?: boolean | undefined;
  bigint?: boolean | undefined;
  validator?: { input?: StandardSchemaV1; output?: StandardSchemaV1 } | undefined;
  fieldName?: string | undefined;        // 物理列名
  sortable?: boolean | undefined;
  index?: boolean | undefined;           // 默认 false
};

export type DBFieldAttribute<T extends DBFieldType = DBFieldType> =
  { type: T } & DBFieldAttributeConfig;

// 表级索引
// 来源：packages/core/src/db/type.ts:286-293
export interface DBTableIndex {
  fields: readonly [string, ...string[]];   // 1–16 个逻辑字段，按索引顺序
  name?: string | undefined;                // 至多 63 UTF-8 字节
  unique?: boolean | undefined;
}

// 表模型
// 来源：packages/core/src/db/type.ts:295-318
export type BetterAuthDBSchema = Record<string, {
  modelName: string;                          // 物理表名
  fields: Record<string, DBFieldAttribute>;
  indexes?: readonly DBTableIndex[] | undefined;
  disableMigrations?: boolean | undefined;     // 默认 false
  order?: number | undefined;
}>;

// 二级存储契约
// 来源：packages/core/src/db/type.ts:320-363
export interface SecondaryStorage {
  get: (key: string) => Awaitable<unknown>;
  getAndDelete: (key: string) => Awaitable<unknown>;        // 原子取并删
  increment: (key: string, ttl: number) => Awaitable<number>; // 原子自增，ttl 单位秒
  set: (key: string, value: string, ttl?: number | undefined) => Awaitable<void | null | unknown>;
  delete: (key: string) => Awaitable<void | null | string>;
}

// 适配器工厂配置
// 来源：packages/core/src/db/adapter/types.ts:17-32
export interface AdapterFactoryConfig extends Omit<DBAdapterFactoryConfig<BetterAuthOptions>, "transaction"> {
  transaction?: false | (<R>(callback: (trx: DBTransactionAdapter) => Promise<R>) => Promise<R>) | undefined;
}

// 定制适配器创建者：工厂向自定义适配器暴露的能力面
// 来源：packages/core/src/db/adapter/types.ts:34-129
export type AdapterFactoryCustomizeAdapterCreator = (config: {
  options: BetterAuthOptions;
  schema: BetterAuthDBSchema;
  debugLog: (...args: unknown[]) => void;
  getModelName: (model: string) => string;               // 逻辑模型名 → 物理表名
  getFieldName: (input: { model: string; field: string }) => string;  // 逻辑字段名 → 物理列名
  getDefaultModelName: (model: string) => string;
  getDefaultFieldName: (input: { model: string; field: string }) => string;
  getFieldAttributes: (input: { model: string; field: string }) => DBFieldAttribute;
  transformInput: (
    data: Record<string, unknown>,
    defaultModelName: string,
    action: "create" | "update",
    forceAllowId?: boolean | undefined,
  ) => Promise<Record<string, unknown>>;
  transformOutput: (
    data: Record<string, unknown>,
    defaultModelName: string,
    select?: string[] | undefined,
    joinConfig?: JoinConfig | undefined,
  ) => Promise<Record<string, unknown>>;
  transformWhereClause: <W extends Where[] | undefined>(input: {
    where: W;
    model: string;
    action:
      | "create" | "update" | "findOne" | "findMany" | "updateMany"
      | "delete" | "deleteMany" | "consumeOne" | "incrementOne" | "count";
  }) => W extends undefined ? undefined : CleanedWhere[];
}) => CustomAdapter;
```

### 8.4 Flow

以下伪代码描述存储域从「模型装配」到「原子操作」的三段链路，以及失败分支与恢复策略。

#### Schema Merge Chain

以下伪代码表达核心表与插件表的合并顺序与规则。

```ts
// 入口：getAuthTables(options)
// 来源：packages/core/src/db/get-tables.ts:29-350
function buildAuthTables(options: BetterAuthOptions): BetterAuthDBSchema {
  // 第 1 步：按插件声明顺序归并插件表
  const pluginSchema = (options.plugins ?? []).reduce((acc, plugin) => {
    const schema = plugin.schema;
    if (!schema) return acc;
    for (const [key, value] of Object.entries(schema)) {
      acc[key] = {
        fields: { ...acc[key]?.fields, ...value.fields },     // 同名字段：后者覆盖前者
        indexes: mergeTableIndexes(acc[key]?.indexes, value.indexes),  // 按定义去重合并
        modelName: value.modelName || key,                    // 模型名可被改写
        disableMigrations: value.disableMigration ?? acc[key]?.disableMigrations,
      };
    }
    return acc;
  }, {});

  // 第 2 步：拆出核心表与插件表
  const { user, session, account, verification, ...pluginTables } = pluginSchema;

  // 第 3 步：装配核心表（字段顺序固定，宿主 additionalFields 最后展开）
  const authTables = {
    user: { modelName: options.user?.modelName || "user", indexes: user?.indexes,
      fields: { name: {...}, email: { unique: true, required: true, sortable: true },
        emailVerified: { defaultValue: false, input: false }, image: {...},
        createdAt: {...}, updatedAt: {...},
        ...user?.fields, ...options.user?.additionalFields }, order: 1 },
    // 二级存储承载会话时不再生成 session 表
    ...(!options.secondaryStorage || options.session?.storeSessionInDatabase ? sessionTable : {}),
    account: { modelName: options.account?.modelName || "account", indexes: account?.indexes,
      fields: { accountId, providerId, userId: { references: { model: "user", field: "id", onDelete: "cascade" } },
        accessToken: { returned: false }, refreshToken: { returned: false }, idToken: { returned: false },
        accessTokenExpiresAt: { returned: false }, refreshTokenExpiresAt: { returned: false },
        scope, password: { returned: false }, createdAt, updatedAt,
        ...account?.fields, ...options.account?.additionalFields }, order: 3 },
    // 二级存储承载校验凭据时不再生成 verification 表
    ...(!options.secondaryStorage || options.verification?.storeInDatabase ? verificationTable : {}),
    ...pluginTables,
    // 限流表仅在 rateLimit.storage === "database" 时生成
    ...(options.rateLimit?.storage === "database" ? rateLimitTable : {}),
  };
  return authTables;
}
```

合并顺序是确定的：插件先归并（内部按声明顺序，后者覆盖前者），核心表随后装配（其自身字段优先，插件同名字段在 `...user?.fields` 之后由插件归并结果带入），最后是插件表与限流表。

#### Adapter Wrapping Chain

以下伪代码表达原生适配器被包装为统一契约面的过程。

```ts
// 入口：createAdapterFactory({ adapter, config })(options)
// 来源：packages/core/src/db/adapter/factory.ts:55-79, 970-1045, 1382-1447
export const createAdapterFactory = ({ adapter: customAdapter, config: cfg }) =>
  (options): DBAdapter => {
    const config = {
      ...cfg,
      supportsBooleans: cfg.supportsBooleans ?? true,
      supportsDates:    cfg.supportsDates    ?? true,
      supportsJSON:     cfg.supportsJSON     ?? false,
      supportsNumericIds: cfg.supportsNumericIds ?? true,
      supportsUUIDs:    cfg.supportsUUIDs    ?? false,
      supportsArrays:   cfg.supportsArrays   ?? false,
      transaction:      cfg.transaction      ?? false,
    };

    const schema = getAuthTables(options);      // 表模型在此定型
    // ... 名称映射、字段变换、条件规范化、id 字段装配 ...

    const atomicFallbacks = createAtomicFallbacks({
      adapter: adapterInstance, adapterId: config.adapterId,
      mapKeysTransformInput: config.mapKeysTransformInput,
      mapKeysTransformOutput: config.mapKeysTransformOutput,
      getFieldName, transformOutput, transformWhereClause,
    });

    return {
      id: config.adapterId,

      update: async ({ model, where: unsafeWhere, update: unsafeData }) => {
        const modelKey = getDefaultModelName(model);
        const where = transformWhereClause({ model: modelKey, where: unsafeWhere, action: "update" });
        // 失败分支：空谓词没有目标行 → 拒绝执行，返回 null（决策 1）
        if (where.length === 0) return null;
        const data = config.disableTransformInput
          ? unsafeData : await transformInput(unsafeData, modelKey, "update");
        const res = await adapterInstance.update({ model: getModelName(modelKey), modelKey, where, update: data });
        // 适配器返回 null 表示零行命中，透传为 null
        return config.disableTransformOutput ? res : await transformOutput(res, modelKey, undefined, undefined);
      },

      consumeOne: async ({ model, where: unsafeWhere }) => {
        const modelKey = getDefaultModelName(model);
        const where = transformWhereClause({ model: modelKey, where: unsafeWhere, action: "consumeOne" });
        // 优先使用原生实现；没有则走快照守卫降级（决策 2）
        const res = adapterInstance.consumeOne
          ? await adapterInstance.consumeOne({ model: getModelName(modelKey), modelKey, where })
          : await atomicFallbacks.consumeOne({ model: getModelName(modelKey), modelKey, where });
        return res && !config.disableTransformOutput
          ? await transformOutput(res, modelKey, undefined, undefined) : res;
      },

      incrementOne: async ({ model, where: unsafeWhere, increment, set }) => {
        // 失败分支：增量与赋值同时为空 → 抛错，不做空操作
        if (Object.keys(increment).length === 0 && Object.keys(set ?? {}).length === 0) {
          throw new BetterAuthError("incrementOne requires a non-empty `increment` or `set`; both were empty.");
        }
        const modelKey = getDefaultModelName(model);
        const where = transformWhereClause({ model: modelKey, where: unsafeWhere, action: "incrementOne" });
        const res = adapterInstance.incrementOne
          ? await adapterInstance.incrementOne({ model: getModelName(modelKey), modelKey, where, increment, set })
          : await atomicFallbacks.incrementOne({ model: getModelName(modelKey), modelKey, where, increment, set });
        return res && !config.disableTransformOutput
          ? await transformOutput(res, modelKey, undefined, undefined) : res;
      },
      // ... create / findOne / findMany / count / updateMany / delete / deleteMany / transaction
    };
  };
```

#### Atomic Fallback Chain

以下伪代码表达适配器缺少原生原子能力时的降级实现。

```ts
// 来源：packages/core/src/db/adapter/atomic-fallback.ts:54-247
export function createAtomicFallbacks(context: FallbackContext) {
  const MAX_ATTEMPTS = 5;

  // 受影响行数必须是 0 或 1，否则说明适配器语义不成立 —— 抛错，不静默继续
  function changedOne(count: number): boolean {
    if (count !== 0 && count !== 1) {
      throw new BetterAuthError(
        `Adapter "${context.adapterId}" must return an affected row count of 0 or 1 from an atomic fallback.`);
    }
    return count === 1;
  }

  // 快照守卫：把读到的行内容与主键一起转成 AND 谓词，作为删除/更新的条件
  async function snapshotGuard(row, fields, request, action): Promise<CleanedWhere[]> {
    const id = await idWhere(row, request.modelKey, action);
    const hasOr = request.where.some((clause) => clause.connector === "OR");
    const guard: CleanedWhere[] = hasOr ? [id] : [...request.where, id];
    for (const field of new Set(fields)) {
      if (field === id.field) continue;
      const value = scalar.safeParse(row[field] ?? null);
      if (!value.success) {
        // 失败分支：OR 谓词 + 结构化值 → 无法用等值守卫表达，要求适配器提供原生实现
        if (hasOr && request.where.some((clause) => clause.field === field)) {
          throw new BetterAuthError(
            `Adapter "${context.adapterId}" must implement native atomic methods for OR predicates on structured values.`);
        }
        continue;
      }
      guard.push({ field, value: value.data, operator: "eq", connector: "AND", mode: "sensitive" });
    }
    return guard;
  }

  async function consumeOne(request): Promise<StoredRow | null> {
    const row = await readRow(request);
    if (row === null) return null;                 // 失败分支：无匹配行
    const guard = await snapshotGuard(row, [...Object.keys(row), ...request.where.map(({ field }) => field)],
      request, "consumeOne");
    const count = await adapter.deleteMany({ model, modelKey, where: guard });
    // 只有恰删一行才算消费成功；删了多行说明谓词不唯一 → 抛错（决策 2）
    return changedOne(count) ? row : null;
  }

  async function incrementOne(request): Promise<StoredRow | null> {
    const mutation = mutationSchema.safeParse(request);
    // 失败分支：增量非有限数或 set 非法 → 抛错
    if (!mutation.success) {
      throw new BetterAuthError("incrementOne requires finite increments and a set object for the atomic fallback.");
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await readRow(request);
      if (row === null) return null;               // 守卫未命中 → 不做修改（决策 3）
      const update = { ...set };
      for (const [field, delta] of Object.entries(increment)) {
        const previous = counterSchema.safeParse(row[field]);
        // 失败分支：计数不是有限数值 → 抛错
        if (!previous.success) {
          throw new BetterAuthError(
            `Adapter "${context.adapterId}" must return finite numeric counter values or null for atomic increments.`);
        }
        const next = (previous.data ?? 0) + delta;
        // 失败分支：无法安全表示该增量 → 抛错
        if (!Number.isFinite(next) || (delta !== 0 && next === current)) {
          throw new BetterAuthError(
            `Adapter "${context.adapterId}" cannot represent the requested counter increment safely.`);
        }
        update[field] = next;
      }
      const guard = await snapshotGuard(row, fields, request, "incrementOne");
      // 空操作在读时即生效（只计变更行的存储会报 0）
      if (everyEntryUnchanged(row, update)) return row;
      const count = await adapter.updateMany({ model, modelKey, where: guard, update });
      if (changedOne(count)) return { ...row, ...update };
    }
    // 失败分支：竞争耗尽 → 抛错而非返回 null（决策 3）
    throw new BetterAuthError(
      `Adapter "${context.adapterId}" could not complete an atomic increment due to contention. Retry the operation or implement incrementOne natively.`);
  }

  return { consumeOne, incrementOne };
}
```

#### Transaction Chain

以下伪代码表达事务入口与不支持事务时的退化行为。

```ts
// 来源：packages/core/src/db/adapter/factory.ts:46-49（不支持事务时的退化）
const createAsIsTransaction = (adapter: DBAdapter) => <R>(fn: (trx) => Promise<R>) => fn(adapter);

// 使用侧（身份域的新主体创建）：主体与账号绑定必须同生共死
// 来源：packages/better-auth/src/oauth2/link-account.ts:580-599
const { createdUser, createdAccount } = await runWithTransaction(c.context.adapter, async () => {
  const createdUser = await c.context.internalAdapter.createUser({ ... }, source);
  const createdAccount = await c.context.internalAdapter.createAccount({ ...accountData, userId: createdUser.id });
  return { createdUser, createdAccount };
});
```

#### Idempotency and Recovery

以下六条策略说明存储域各类操作在重复执行与失败后的行为。

- **更新的幂等**：同一条件重复执行 `update`，若条件仍匹配则重复写入同一份数据（结果幂等）；若条件不再匹配则返回 `null`——调用方必须以 `null` 为失败信号，不得当作成功。
- **消费的幂等**：`consumeOne` 天然幂等——第一次消费拿到行，之后每次都拿到 `null`，重复调用不会重复发放凭据。
- **增量的幂等**：同样的 `increment` 重复执行会重复加值，因此**不幂等**；这类操作必须靠 `where` 守卫使重复调用变成空操作（第二次守卫不匹配，返回 `null`）。
- **事务失败恢复**：事务回调抛错时整体回滚，不留半成品记录；由于适配器可能多次执行事务回调，**事务外的副作用**（发邮件、写二级存储等）必须放进 `queueAfterTransactionHook`，否则会被重复触发。
- **降级路径的恢复**：快照守卫降级实现依赖「读—改—条件写」三步。若在写阶段发现受影响行数不为 0 或 1，抛错而不是猜测结果；`incrementOne` 的 CAS 重试耗尽后同样抛错，调用方应重试或改用原生实现。
- **表结构不匹配的恢复**：表结构校验失败只记日志、不阻断请求（`packages/better-auth/src/auth/base.ts:27-36`）；修复方式是由[命令行域](./11-cli/)重新生成并执行迁移，而不是在运行期热修。

### 8.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| C1 | 数据库中 `verification` 表存在一行 `identifier = "abc"`；适配器已就绪 | 调用 `adapter.update({ model: "verification", where: [{ field: "identifier", value: "abc" }], update: { value: "x" } })` | 返回更新后的行，`value` 为 `"x"`；再次用同一条件调用，返回 `null`（零行命中即失败，决策 1） |
| C2 | 数据库中无任何满足条件的行 | 调用 `adapter.update({ model: "verification", where: [{ field: "identifier", value: "missing" }], update: { value: "x" } })` | 返回 `null`；数据库中**未新增任何行**——更新不得凭空插入一行；调用方据此判定更新失败 |
| C3 | 数据库中无满足 `where` 的行 | 调用 `adapter.update({ model: "verification", where: [], update: { value: "x" } })` | 返回 `null` 且不发生任何写入（空谓词被工厂短路，决策 1） |
| C4 | 数据库中有一行 `identifier = "otp-1"`，且该行 `value` 为一次性凭据 | 并发发起两次 `adapter.consumeOne({ model: "verification", where: [{ field: "identifier", value: "otp-1" }] })` | 恰好一次返回该行，另一次返回 `null`；数据库中该行被删除且**只删一行**（决策 2） |
| C5 | 数据库中有一行，`remaining = 1`，无其他字段 | 调用 `adapter.incrementOne({ model: "…", where: [{ field: "remaining", operator: "gt", value: 0 }], increment: { remaining: -1 } })` 两次 | 第一次返回该行且 `remaining` 变为 `0`；第二次守卫不匹配，返回 `null` 且 `remaining` 保持 `0`（决策 3） |
| C6 | 适配器未提供原生 `consumeOne`（走降级路径） | 调用 `consumeOne`，且适配器的 `deleteMany` 返回受影响行数 `2` | 抛出 `BetterAuthError`，消息含 `must return an affected row count of 0 or 1`；不返回任何行，不把多行删除当作成功（决策 2） |
| C7 | 适配器未提供原生 `incrementOne`（走降级路径），且每次写都因竞争失败 | 调用 `incrementOne` | 重试至上限后抛出 `BetterAuthError`，消息含 `could not complete an atomic increment due to contention`；**不返回 `null`**（决策 3） |
| C8 | 两个插件先后声明同名字段 `shared.note`，第二个插件的 `note` 类型为 `number`；第二个插件声明 `disableMigration: true` | 读取 `getAuthTables(options)` | `shared.note.type` 为 `"number"`（后者覆盖前者）；`shared.disableMigrations` 为 `true`（决策 4） |
| C9 | 插件 A 与插件 B 都声明索引 `{ fields: ["a"], unique: true }` | 读取 `getAuthTables(options)` 的 `indexes` | 该索引只出现一次（按 `[name, fields, unique]` 定义去重，决策 4） |
| C10 | 宿主配置 `secondaryStorage` 且未设置 `session.storeSessionInDatabase` | 读取 `getAuthTables(options)` | 结果中**不含** `session` 表键；`verification` 表键仅在 `verification.storeInDatabase` 为真时存在 |
| C11 | 宿主配置 `rateLimit.storage` 为 `"memory"` | 读取 `getAuthTables(options)` | 结果中**不含** `rateLimit` 表键；改为 `"database"` 后该表出现且含 `key`（唯一）、`count`、`lastRequest` 三个字段 |
| C12 | 数据库结构与表模型不一致（缺少一列） | 发起一次正常请求 | 请求**不被阻断**；日志出现表结构校验失败信息；表模型的修复路径是由命令行域重新生成迁移，而不是运行期热修 |
