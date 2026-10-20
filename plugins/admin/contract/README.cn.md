# `@veren/admin-contract`

适用于需要 DSH 后台平台稳定 Host 能力契约的包：它声明能力名、provider 清单、结构化
错误、数据端口、统一 API 路由词汇，以及消费方依赖的 auth/access/navigation/audit/
settings/docs 接口，因此每个消费方都可以忽略背后是哪个 provider 实现；只需要浏览器侧
UI 契约（`@veren/admin-ui-contract`）时不要使用本包。

本包**没有运行时依赖**：引用它绝不会拉入实现。消费方只依赖本包；provider 是内核
façade 之后的可替换实现。

## 能力

| 名称 | 必需 | `@veren/admin-app` 中的默认 provider |
|---|---|---|
| `data` | 是 | `@veren/admin-data-postgres`（回退：`@veren/admin-data-dsh-kv`） |
| `auth` | 是 | `@veren/admin-auth-local` |
| `access` | 是 | `@veren/admin-access-rbac` |
| `navigation` | 是 | `@veren/admin-navigation-default` |
| `audit` | 是 | `@veren/admin-audit-default` |
| `settings` | 否 | 尚未提供（P1） |
| `docs` | 否 | `@veren/admin-docs-openapi` |

缺少必需能力 ⇒ 启动失败并报 `ESSENTIAL_CAPABILITY_MISSING`。缺少可选能力 ⇒
`features` 报 `false`，其 UI 保持隐藏。

## provider 声明

`ProviderManifest` 包含 `id`、`capability`、`contract`（范围）、`priority`、
可选 `dataDomain`、可选 `migrations` 与显示用 `label`。内核激活“范围接纳
`ADMIN_CONTRACT_VERSION`（`1.0.0`）且优先级最高”的实现。替换实现必须使用**不同的**
优先级；同一能力的两个相同优先级会被拒绝。

## 版本范围

`satisfies(version, range)`（位于 `@veren/admin-kernel`）支持 `*`/`x`、精确值、
`>= <= > <`、`^`（同主版本）、`~`（同主次版本）、空白表示“与”、`||` 表示“或”。
畸形范围在注册时抛出。

## 错误

`AdminError` 携带稳定 `code`、可选 `details` 对象、HTTP `status`，以及由网关填充的
`requestId`。

| 错误码 | 状态 | 错误码 | 状态 |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 | `RATE_LIMITED` | 429 |
| `FORBIDDEN` | 403 | `SETUP_REQUIRED` | 428 |
| `CSRF_FAILED` | 403 | `ALREADY_INITIALIZED` / `LAST_OWNER` | 409 |
| `VALIDATION_FAILED` | 422 | `CAPABILITY_UNAVAILABLE` / `BACKEND_UNAVAILABLE` | 503 |
| `NOT_FOUND` / `METHOD_NOT_ALLOWED` | 404 / 405 | `CONTRACT_INCOMPATIBLE` / `PROVIDER_CONFLICT` | 500 |
| `CONFLICT` | 409 | `ESSENTIAL_CAPABILITY_MISSING` / `INTERNAL` | 500 |
| `PAYLOAD_TOO_LARGE` | 413 | | |

## 协议常量

`ADMIN_SESSION_COOKIE = 'admin_session'`（HttpOnly）、`ADMIN_CSRF_COOKIE =
'admin_csrf'`（可读，双提交）、`ADMIN_CSRF_HEADER = 'x-csrf-token'`。
`ADMIN_PERMISSIONS` 是路由、角色与客户端共同比较的唯一权限目录。

## 数据端口

`AdminDatabase.table<T>(name)` 返回 `AdminTable<T>`：同步的 `find`、`list`、`size`
（适配器在内存中保留已校验状态），异步的 `save` 与 `remove`。`transaction(work)` 收到的
`AdminUnitOfWork` 中，`table()` 解析出事务绑定句柄。`features` 如实报告引擎能力——
DSH KV 适配器报告 `transactions: false`，并说明失败的事务不会回滚。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/contract
```
