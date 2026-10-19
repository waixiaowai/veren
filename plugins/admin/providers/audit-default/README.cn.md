# @veren/admin-audit-default

DSH 后台平台的默认 `audit` 能力 provider。它通过共享的 `data` 端口把只追加的治理轨迹保存在
`admin_audit` 集合中，并以一个需要认证的列表端点对外提供。

## 提供什么

- `@veren/admin-contract` 中 `AdminAudit` 的实现，通过
  `ctx.admin.register(manifest, implementation)` 注册到 `ctx.adminAudit` façade 之后。
- `record(entry)`：追加一条记录，自动生成 UUID 与 ISO-8601 UTC 时间戳，随后执行条目上限与
  保留窗口。
- `list(query)`：过滤、按时间倒序、游标分页。
- `health()`：探测数据集合，返回 `ok` 或 `down`。
- `GET /api/admin/v1/audit`：`list` 的薄 HTTP 投影。

能力注册与路由注册都放在 `ctx.effect(...)` 中，因此卸载插件会一并移除能力与路由。provider
只注册清单，不向消费方暴露具体实现：用另一个审计 provider 替换本包不会改变调用方。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxEntries` | `100000` | 最多保留的条目数，超出时优先删除最旧的条目。必须是正整数。 |
| `retentionDays` | `180` | 保留窗口（天）。早于 `now - retentionDays` 的条目会被删除。必须是正整数。 |

两个字段都是可选的；provider 自行应用默认值，因此直接嵌入方与测试获得与加载器一致的行为。
非法值会以 `AdminError('VALIDATION_FAILED', ...)` 明确失败。

```ts
// profile 行
plugins:
  - id: admin-audit-default
    config:
      maxEntries: 50000
      retentionDays: 90
```

## 路由

| 方法 | 路径 | 权限 | 标签 |
|---|---|---|---|
| `GET` | `/api/admin/v1/audit` | `admin.audit.read` | `audit` |

注册时的路由路径相对受众（`/audit`）；上表是网关推导出的公开路径。

查询参数由路由声明的 `query` schema 校验：

| 参数 | 含义 |
|---|---|
| `limit` | 页大小，默认 50，超过 200 会被截断到 200。 |
| `cursor` | 上一页 `nextCursor` 返回的不透明游标。 |
| `actorId` | 精确匹配操作者用户 id。 |
| `action` | 动作名前缀，例如 `auth.`。 |
| `result` | `intent`、`success`、`failure`、`denied` 之一。 |
| `since` | 闭区间时间下界，ISO-8601。 |
| `until` | 闭区间时间上界，ISO-8601。 |

响应：`{ items, nextCursor? }`，`items` 最新的在前。

排序先按 `at` 降序，再按 `id` 降序以获得确定的并列顺序。游标以 base64 编码数字偏移量；对客户端
不透明，编码方式可能变化。非法的游标、limit、`since` 或 `until` 会抛出 `VALIDATION_FAILED`。

## 保留不变式

裁剪按从旧到新的顺序遍历集合。条目上限消耗该顺序的前缀，保留截止点则是时间边界，因此绝不会在
保留较旧条目的同时丢弃较新的条目。删除是顺序执行的：即使只完成一部分，也仍是正确的裁剪。

## 已知限制

- **写入时全集合扫描。** `record()` 为决定裁剪内容会列出整个集合。DSH KV 适配器没有二级索引，
  因此每次追加都是一次全扫描。带 `at` 索引的 SQL 适配器会高效得多，但 `data` 契约目前没有
  暴露该能力。
- **裁剪非原子。** 追加与裁剪是两个 `data` 端口操作。若进程在两者之间停止，轨迹会暂时超出上限，
  下一次追加会修复。不会丢数据。
- **不是 WORM 存储。** “只追加”是 provider 的策略，不是引擎保证：`data` 端口仍可覆盖或删除行。
  完整性依赖引擎的访问控制与备份。
- **随机 id。** id 是 UUIDv4 而非时间有序；除同一毫秒内的并列排序外，排序从不依赖它。
- **偏移量游标。** 游标是数字偏移，两页之间追加的条目可能让某行跨越页边界。治理读取可以接受；
  若需要快照一致的导出，需要 `at`+`id` 的 keyset 游标，而这要求带索引的数据引擎。
- **查询校验会发生两次。** 网关在 handler 之前校验 `route.query`；handler 仍会重新读取
  `request.query`，因为网关保留的是原始 `URLSearchParams` 而非解析后的对象。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/audit-default
```

套件覆盖注册与释放、追加与裁剪、保留期、过滤、游标分页与路由信封。
