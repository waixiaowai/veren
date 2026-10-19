# @veren/admin-navigation-default

DSH 后台平台的默认 `navigation` 能力 provider。它拥有菜单注册表并自带基线管理菜单；外壳渲染
该能力为当前主体返回的内容。

## 提供什么

- `@veren/admin-contract` 中 `AdminNavigation` 的实现，注册到 `ctx.adminNavigation` façade
  之后。
- `register(item)`：添加一条 `AdminNavContribution` 并返回幂等 disposer。重复 id 会抛出
  `AdminError('CONFLICT', ...)`；注册表绝不会静默替换其他模块的条目。
- `tree(principal)`：按权限过滤、排序，并投影为 `AdminNavNode`。
- `health()`：注册表可读时返回 `ok`。
- 下方列出的默认贡献项，由 provider 自身注册。

**没有 HTTP 路由**：菜单由外壳在进程内读取，每条路由各自保留服务端权限校验。隐藏菜单项属于
UX，而不是授权手段。

## 默认贡献项

| id | 路径 | 图标 | 权限 | labelKey | order |
|---|---|---|---|---|---|
| `dashboard` | `/` | `dashboard` | `admin.dashboard.read` | `nav.dashboard` | 10 |
| `users` | `/users` | `users` | `admin.users.manage` | `nav.users` | 20 |
| `roles` | `/roles` | `shield` | `admin.roles.manage` | `nav.roles` | 30 |
| `audit` | `/audit` | `audit` | `admin.audit.read` | `nav.audit` | 40 |
| `capabilities` | `/system/capabilities` | `capabilities` | `admin.capabilities.read` | `nav.capabilities` | 50 |

order 以十为步长，模块因此可以在默认项之间插入条目（例如 `order: 25`）而无需重编号。

## 配置

无。`Config` 是空 schema：默认条目是代码，贡献项在运行期来自其他模块。保持空形状意味着 profile
行无法静默传入会被忽略的选项。

## 排序与过滤

1. 过滤：没有 `permission` 的条目总是可见；否则 provider 询问
   `ctx.adminAccess.can(principal, permission)`。
2. 分组：按 `group` 分桶（缺省归入同一个无名桶）。桶的顺序取其首个成员的注册顺序，因此一个
   模块的条目保持相邻。
3. 桶内按 `order ?? 0` 排序，再按 `id` 获得确定的并列顺序。
4. 投影为 `AdminNavNode`。

过滤发生在排序之前，因此被拒条目不会留下空洞。

## 已知限制

- **内存注册表。** 插件卸载后贡献项丢失，由各模块在加载时重建。没有持久化、没有按用户覆盖，
  也没有运行期重排 UI。
- **无角标。** 刻意省略 `AdminNavNode.badge`：角标计数属于拥有数据的模块，本 provider 没有
  这类数据。拥有计数的模块需要扩展 navigation（或外壳）来提供。
- **id 冲突会让插件加载失败。** 重复 id 在注册时抛出。模块应给 id 加命名空间
  （`module.entry`），避免拖垮自身加载。
- **权限过滤信任 access provider。** 若 `access` 缺失，`tree` 会抛
  `CAPABILITY_UNAVAILABLE`，而不是显示全部；该能力是必需能力，启动门禁本应更早发现。
- **默认条目不可配置。** 部署若需要不同基线，请替换（或禁用）本 provider；没有逐条目开关。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/nav-default
```

套件覆盖注册与释放、默认条目、权限过滤、分组排序、重复 id 冲突与幂等 disposer。
