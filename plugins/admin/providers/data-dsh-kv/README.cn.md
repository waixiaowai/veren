# @veren/admin-data-dsh-kv

DSH 后台平台的 `data` 能力 provider，由单个自声明的 DSH 存储域支撑。它实现
`@veren/admin-contract` 的 `AdminDatabase` 并向内核注册自身，因此所有消费方仍然只
面对稳定的 `ctx.adminData` façade，看不到底层介质。

这是嵌入式/零配置回退方案。推荐的生产后端是 `@veren/admin-data-postgres`；优先级 `0`
让该 provider 可以接管，而无需改动本包。

## 提供什么

- 在 `src/adapter.ts` 中基于结构化 KV 句柄实现的 `AdminDatabase`（`table`、
  `transaction`、`health`、`features`）。
- `src/domain.ts` 中的 `admin_data` domain 声明。
- `src/plugin.ts` 中的 provider 注册：清单 `{ id: 'dsh-kv', capability: 'data',
  contract: '^1.0', priority: 0, dataDomain: 'admin_data' }`，经 `ctx.effect` 接线。
- `features = { transactions: false, secondaryIndexes: false, fullText: false }`：
  引擎如实报告自己做不到的事，而不是假装支持。

优先级 `0` 为更高优先级的 provider（例如 SQL 引擎）留出接管空间，无需改动本包。

## 存储布局

单 domain、单表、每条记录一个文档：

| 项 | 值 |
|---|---|
| domain | `admin_data`，版本 `1`，布局 `per-record` |
| 表 | `records` |
| 键 | `` `<hex(collection)>_<hex(id)>` `` |
| 值 | 存储的记录对象 |

两个键段都是其 UTF-8 字节的小写十六进制，并用 `_` 连接。十六进制只用 `[0-9a-f]`，满足
JSON 后端 per-record 布局的 path-safe 规则（`/^[a-zA-Z0-9_-]+$/`），且不会与 `_` 分隔符
冲突，因此包含 `:`、`/`、`.` 或非 ASCII 文本的集合名与 id 都能存储而不会串入另一个集合。

记录 schema 是只要求 `id: string` 的宽松对象，因为各能力独立拥有并演进其余字段。
缺失 `id` 的手工编辑或截断文档仍会让 domain 打开显式失败，而不是被静默跳过。

集合是虚拟的：一个仓库就是单表内 `` `<hex(collection)>_` `` 这个键前缀，因此新增能力
既不需要 schema 变更，也不需要迁移。集合 `admin_users` 中的 `find('u1')` 读取
`('admin_users', 'u1')` 对应的键；`list()` 与 `size` 只统计该前缀下的键，所以
`admin_user` 与 `admin_users` 永远不会看到彼此的记录。

介质（`json`、`sqlite` 等）由 storage group 的 `backend`/`routes` 配置决定；本插件
从不直接打开后端。

## 配置

```yaml
storage:
  backend: json        # 该 domain 的默认后端名
  routes:              # 逐 domain 覆盖：domain 名 -> 后端名
    admin_data: sqlite
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `storage.backend` | `json` | 没有路由命中时服务该 domain 的后端 |
| `storage.routes` | `{}` | 逐 domain 覆盖；`admin_data` 条目优先 |

`storage.backend` 与 `storage.routes` 中出现的每个名字都必须是已注册后端。拼写错误
会让插件加载失败，并同时给出出错的名字与已注册名单，而不是静默写入另一个介质。

## 事务：降级保证

`transaction(work)` 让 `work` 走一条内部 promise 链，因此两个重叠的事务绝不会交错：
第二个只在第一个结算后才开始。它返回工作单元的返回值，且**不回滚**。

调用方必须为之规划的结果：

- 抛出异常的工作单元会把异常上报调用方；抛错之前写入的记录保持写入状态。
- 失败的事务不会污染链：下一个事务照常执行。
- 事务之外发起的写入不会与事务串行（domain 自身对单次写入有写链，因此单条写入仍按
  顺序落盘，但“读—改—写”序列只在 `transaction` 内受到保护）。

这是 KV 对账路径：需要多记录原子变更的部署必须让自己的写入幂等（或在失败后重读并
修复），否则应把本 provider 换成事务型引擎。能力目录如实公布
`transactions: false`，模块可据此拒绝在此运行。

## 读取、列举与规模

读取同步返回，因为存储域在内存中保留已校验状态。`list()` 与 `size` 都是**扫描**：
KV 没有二级索引，因此每次调用都遍历表的键快照并按前缀过滤。开销随整张表的记录数
增长，而不只是所请求集合的记录数。

## 健康

`health()` 触碰表句柄：句柄可用时返回 `{ status: 'ok' }`，抛出时返回
`{ status: 'down', detail }`（domain 已关闭、后端已释放、介质损坏）。内核通过
`refreshHealth()` 发布该结论。

## 已知限制

- **没有原子事务。** 见上文的降级保证；`features` 如实报告这一点。
- **没有二级索引与全文检索。** 任何超出 `id` 的查询都由消费方在 `list()` 上自行扫描。
- **没有逐集合校验。** 写入与持久化 schema 只检查 `id`；记录按原样存储，因此各能力
  必须在 `save` 之前校验自己的字段。
- **`find`/`list` 信任命名空间。** 值只是被窄化为所请求的实体类型，并未解析；以另一种
  形状存储的记录会原样返回。
- **不迁移旧键格式。** 早期版本写入 `${collection}:${id}` 键，JSON 后端会以非 path-safe
  拒绝它。本版本不读取这些键；以 SQLite 介质存储过的记录需要重新导入。新键采用上面的
  十六进制形式。
- **同一 domain 名只能打开一次。** 存储设施会拒绝 `admin_data` 的第二次打开；同一进程
  内的两个部署不得同时加载本插件。
- **没有迁移导入器。** 清单未声明 `migrations` 源；搬迁记录属于消费方的任务。
- **没有缓存层。** 每次 `list`/`size` 都遍历表；热点看板应在自己的模块内缓存。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/data-dsh-kv
```

用例让适配器跑在 `Map` 支撑的假 domain 上（逐集合 CRUD、前缀隔离、缺失 id 拒绝、
事务串行与失败传播、健康），并通过真实 `AdminKernel` 驱动插件（注册、façade 访问、
后端校验显式失败、卸载时关闭 domain 并注销能力）。
