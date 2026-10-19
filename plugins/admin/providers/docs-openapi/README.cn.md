# @veren/admin-docs-openapi

DSH 后台平台的默认 `docs` 能力 provider。它发布生成的文档——而不是手写规格——来源是内核能力
目录与 API 网关的实时路由表。

## 提供什么

- `@veren/admin-contract` 中 `AdminDocs` 的实现，注册到 `ctx.adminDocs` façade 之后：
  - `catalog()` 刷新能力与后端健康，然后返回 `ctx.admin.catalog()`。
  - `openapi()` 返回 `ctx.adminApi.openapi()`。
  - `health()` 探测网关。
- 四条路由：

| 方法 | 路径 | 权限 | 标签 |
|---|---|---|---|
| `GET` | `/api/admin/v1/capabilities` | `admin.capabilities.read` | `capabilities` |
| `GET` | `/api/admin/v1/health/backends` | `admin.capabilities.read` | `health` |
| `GET` | `/api/public/v1/openapi.json` | 公开，无需权限 | `docs` |
| `GET` | `/api/admin/v1/docs` | `admin.capabilities.read` | `docs` |

注册的路由路径相对受众（`/capabilities`、`/health/backends`、`/openapi.json`、`/docs`）；
上表是网关推导出的公开路径。

载荷：

- `/capabilities`：完整的 `CapabilityCatalog`（`contractVersion`、带激活 provider 与健康的
  `capabilities[]`、`features`）。
- `/health/backends`：来自 `refreshHealth()` 的 `{ backends: [{ name, health }] }`。
- `/openapi.json`：由全部已注册路由生成的 OpenAPI 3.1 文档。
- `/docs`：文档索引：

```json
{
  "openapi": "/api/public/v1/openapi.json",
  "capabilities": "/api/admin/v1/capabilities",
  "uiManifest": "/api/admin/v1/ui-manifest"
}
```

## OpenAPI 路径差异

设计文档把 OpenAPI 位置写作 `/api/openapi.json`。网关严格按受众前缀路由（`/api/admin/v1/...`、
`/api/public/v1/...`、`/api/terminal/v1/...`），无法表达该方案之外的路径，因此本 provider 在
**`/api/public/v1/openapi.json`** 提供文档，并在 `/docs` 中公布该路径。该 URL 刻意公开：
文档在登录之前生成，且只包含声明的路径、权限与标签——不含部署机密。

## 配置

无。`Config` 是空 schema：公开路径属于契约的一部分，可配置会让生成的客户端依赖 profile 行。

## 已知限制

- **UI manifest 由别处拥有。** `/docs` 公布 `/api/admin/v1/ui-manifest`，但本 provider 并不
  提供它；它由 UI 内核提供。未安装该包的部署访问该公布路径会得到 404。
- **无缓存。** 每次 `/capabilities` 请求都会探测所有能力与 data 后端；OpenAPI 文档每次请求
  重新生成。这是刻意的——生成的文档绝不会与实时路由表不一致——但使这些端点不适合高频轮询。
- **OpenAPI 深度。** 网关生成路径、方法、摘要、标签、安全方案与 `x-admin-*` 元数据，尚未输出
  请求体或查询参数 schema，因此生成的客户端能看到操作形状但看不到字段级细节。
- **openapi 路由会记录自身。** 增加路由会改变文档，包括文档自身的路由；客户端应在运行期获取，
  而不是固定快照。
- **权限名是线上值。** `x-admin-permission` 直接来自路由声明，因此重命名权限对生成的客户端
  与对网关一样是破坏性变更。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/docs-openapi
```

套件覆盖注册与释放、路由元数据、目录与后端健康载荷、生成的 OpenAPI 文档与文档索引。
