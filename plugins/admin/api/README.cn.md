# `@veren/admin-api-kernel`

适用于后台 provider 与模块需要暴露 HTTP 端点、又不愿重复实现安全逻辑的场景：它注册
带受众前缀的路由，并以固定顺序执行请求 id、来源与 CSRF 校验、认证、权限强制、请求体
限制、限流、校验、审计、标准错误信封与生成的 OpenAPI；部署没有 HTTP 面时不要使用本包。

## 路由

provider 注册相对其受众的路径，网关推导公开路径：

| 受众 | 前缀 | 认证 |
|---|---|---|
| `admin` | `/api/admin/v1` | `admin_session` Cookie + CSRF |
| `terminal` | `/api/terminal/v1` | `Authorization: Bearer` + scope |
| `public` | `/api/public/v1` | 无 |

`AdminRoute` 包含 `method`、`path`（支持 `:param` 段）、`audience`、`permission?`、
`scopes?`、`summary`、`action?`、`tags?`、`input?`、`query?`、`audit?`、`handler`。

## 管道（固定顺序）

1. 请求 id（`crypto.randomUUID`）
2. 挂载路径检查 → `NOT_FOUND`
3. 来源检查（拒绝 `null`；同主机或 `trustedOrigins`）
4. `OPTIONS` 预检 → 204
5. 路由匹配 → `NOT_FOUND` / `METHOD_NOT_ALLOWED`
6. 限流 → `RATE_LIMITED`
7. 请求体上限 + JSON 解析（非安全方法）→ `PAYLOAD_TOO_LARGE` / `VALIDATION_FAILED`
8. 认证（`admin` 用会话 Cookie，`terminal` 用 bearer）
9. 非公开路由无身份 → `AUTH_REQUIRED`
10. 非安全非公开方法的 CSRF 双提交 → `CSRF_FAILED`
11. 解析权限，校验 `permission` → `FORBIDDEN`，再校验 `scopes`
12. 校验 `query`，再校验 `input` → `VALIDATION_FAILED`（`details.field`）
13. 审计意图 → handler → 审计结果
14. JSON 响应（`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`）

错误一律渲染 `{ error: { code, message, details?, requestId } }`，状态由错误码映射。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `mountPath` | `/api` | 网关挂载前缀 |
| `maxBodyBytes` | `1048576` | JSON 请求体上限 |
| `rateLimit.window` | `60` | 固定窗口（秒） |
| `rateLimit.max` | `120` | 每窗口每 ip+路由的请求数 |
| `trustedOrigins` | `[]` | 允许调用 API 的额外浏览器来源 |
| `publicUrl` | `''` | 生成 OpenAPI 时使用的对外 URL |

## 行为说明

- 限流是按 `ip|受众|方法|路径` 的固定窗口；没有分布式存储，多实例部署需要外部限流器。
- 审计是**尽力而为**：审计存储失败绝不会把已完成的写操作变成错误；只有 `audit: true`
  的路由产生记录。
- 查询键用 `Object.fromEntries` 折叠（后值覆盖前值）；需要重复键时 handler 仍读取
  `request.query`。
- `OPTIONS` 在路由匹配之前全局应答。

## OpenAPI

`adminApi.openapi()` 由实时路由表生成 OpenAPI 3.1，每个操作带 `x-admin-permission`
与 `x-admin-audience`。未注册的路由不会出现在文档里。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/api
```
