# `@veren/admin-web`

适用于后台部署需要提供浏览器 SPA 的场景：它挂载带严格内容安全策略的同源壳、提供静态
资源与注册的 UI 包文件（绝不越出各自根目录）、发布把身份、权限、导航与功能开关连接起来
的 bootstrap 载荷，并执行必需能力启动门禁；纯 API 部署不要使用本包。

## 提供的 URL

| 路径 | 响应 |
|---|---|
| `/` | 302 → `<mountPath>/` |
| `/admin` 与 `/admin/` | SPA 壳（`client/index.html`） |
| `/admin/<任意无点路径>` | SPA 壳（History API 深链） |
| `/admin/assets/*` | 包内 `client/` 目录的静态文件 |
| `/admin/ui-plugins/<pack>/<file>` | 由 `admin-ui-kernel` 解析的包资源 |
| `/api/**` | 由 `@veren/admin-api-kernel` 处理，非本包 |

## 新增的 API 路由

| 路由 | 载荷 |
|---|---|
| `GET /api/admin/v1/bootstrap` | `{ user, permissions, nav, features, contractVersion, csrfToken }` |
| `GET /api/public/v1/ui-manifest` | 登录前可用的核心包 |
| `GET /api/admin/v1/ui-manifest` | 登录后可用的全部包 |

`bootstrap` 是唯一把身份、权限、导航与功能开关连接起来的地方，因此 SPA 用一次响应渲染
首个界面。未挂载 UI 内核时，两份清单降级为 `{ uiContract: '1.0.0', packs: [] }`。

## 安全

- 壳文档附带 `Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';
  base-uri 'none'; frame-ancestors 'none'`，以及 `Referrer-Policy: no-referrer`
  与 `X-Frame-Options: DENY`。
- 静态路径在单一根目录内解析，越界即拒绝；只提供白名单扩展名。
- 所有响应都是 `no-store`；这里的内容不面向共享缓存。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `mountPath` | `/admin` | SPA 与资源的挂载位置 |

## 启动门禁

`inject` 包含内核的 `adminReadiness` 服务；该服务只在全部必需能力都有激活 provider 后发布。
因此无论 loader 以什么顺序挂载，Cordis 都会让 `apply` 保持 pending，直到 provider 行注册
完毕——不再需要 profile 级排序垫片。随后 `apply` 调用 `ctx.admin.ready()` 做实时校验，缺少
`data`、`auth`、`access`、`navigation` 或 `audit` 的 profile 仍然无法对外服务，而不是暴露
一个坏掉的壳。

## 已知限制

- SPA 文件位于 `plugins/admin/web/client/`。该目录不存在时（源码检出尚未带浏览器构建
  产物），`/admin` 返回 404，只有 API 路由可用。
- 只有无点路径回落到壳；包含 `.` 的路径返回 404，避免把写错的资源路径渲染成 HTML。
- `mountPath` 不做形态校验；末尾斜杠会被归一化，嵌套路径不受支持。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/web
```
