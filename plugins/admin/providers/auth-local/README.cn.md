# `@veren/admin-auth-local`

适用于后台部署需要本地账号、且不接外部身份提供方的场景：它拥有用户、scrypt 口令散列、
带绝对与空闲过期的浏览器会话、一次性 API token、首次初始化，以及登录/用户/token 路由；
认证必须来自外部 OIDC 或 LDAP 时不要使用本包。

## 凭据

- 口令用 scrypt 散列（`scrypt$<salt>$<key>`，64 字节密钥、16 字节盐），以
  `timingSafeEqual` 校验。
- 会话与 API token 密钥只存 SHA-256 散列。API token 明文（`adm_…`）只返回一次，之后仅保留
  12 字符前缀可见。
- 邮箱唯一性按归一化（小写）地址强制。

## 会话

| 规则 | 行为 |
|---|---|
| 绝对过期 | `createdAt + sessionDays` |
| 空闲过期 | `lastSeenAt + idleHours` |
| 刷新节流 | `lastSeenAt` 最多每分钟写入一次 |
| 退出 | 删除会话记录 |

会话 Cookie 为 `HttpOnly`、`SameSite=Lax`，`secureCookies` 为真时加 `Secure`。CSRF
Cookie 按设计可被脚本读取（双提交）。

## 路由

| 方法 | 路径 | 受众 | 权限 |
|---|---|---|---|
| `GET`/`POST` | `/api/public/v1/setup` | public | — |
| `POST` | `/api/public/v1/login` | public | — |
| `POST` | `/api/admin/v1/logout` | admin | — |
| `GET` | `/api/admin/v1/me` | admin | — |
| `GET`/`POST` | `/api/admin/v1/users` | admin | `admin.users.manage` |
| `PATCH`/`DELETE` | `/api/admin/v1/users/:id` | admin | `admin.users.manage` |
| `GET`/`POST` | `/api/admin/v1/users/:id/tokens` | admin | `admin.tokens.manage` |
| `DELETE` | `/api/admin/v1/tokens/:id` | admin | `admin.tokens.manage` |

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `sessionDays` | `7` | 会话绝对时长 |
| `idleHours` | `12` | 空闲过期 |
| `secureCookies` | `false` | 给 Cookie 加 `Secure`（TLS 后启用） |
| `passwordMinLength` | `8` | 口令策略 |
| `loginRateLimit.window` / `.max` | `60` / `10` | 每邮箱+ip 的登录尝试预算 |

## 防自锁

删除持有 `owner` 且为最后一位所有者的用户会抛出 `LAST_OWNER`。角色绑定本身由 `access`
provider 保护。

## 已知限制

- 邮箱、会话散列、token 散列的查找都是集合扫描；内嵌部署可接受，SQL 引擎上需要索引。
- 没有口令重置、邮箱验证、MFA；除进程内登录限流外没有账号锁定（重启即重置，且按实例）。
- 除退出外，UI 不能列出或撤销会话；改密后撤销全部会话尚未实现。
- 无用户时 `setup` 是开放的，没有 setup token 与 TTL；请把后台 profile 绑定到回环地址，并在
  安装后立即创建所有者。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/providers/auth-local
```
