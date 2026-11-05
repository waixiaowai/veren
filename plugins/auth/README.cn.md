# @veren/web-login-gate

dsh Web GUI 的登录门禁，构建在 `@veren/auth-core` 认证框架之上（设计文档：`plugins/auth/design`）。只有以邮箱+密码登录成功的浏览器才能到达 SPA 入口或任何 `/api` 请求；底层的匿名进程级 launch token 机制原样保留。

当 dsh Web 部署需要具名用户（而非"持有启动 URL 的任何人"）时使用本插件。单一匿名浏览器身份够用，或反代已负责认证时不要使用（本插件不支持部署在会改写 Host/Cookie 的多层反代之后）。

Login gate for the dsh Web GUI, built on the `@veren/auth-core` framework (design document: `plugins/auth/design`). Only a browser that signed in with an email + password reaches the SPA entry or any `/api` request; the anonymous per-process launch-token gate stays untouched underneath.

## 架构 / Architecture

两层相互独立的 Cookie，两道相互独立的闸门 / Two independent cookie layers, two independent gates:

```
浏览器 ── GET /login ──────────────► 公开登录页（本插件）
      ── POST /auth/sign-in/email ► 认证框架（本插件，/auth 前缀路由）
                                    │ users/sessions/accounts/verification
                                    │ 存于 @veren/orm sqlite 数据库
                                    │ （<DSH_HOME>/storages/web_login_gate/auth.db）
      ── GET /?token=… ───────────► [门禁] 有认证会话？── 无 ──► 303 /login（绝不铸 dsh-auth-* Cookie！）
                                    │ 有
                                    ▼
                          ctx.connection.authorizeIndex()
                                    │ 铸出官方签名
                                    ▼
                          dsh-auth-* Cookie + 303 到干净路径
      ── GET / ───────────────────► [门禁] 会话 + dsh-auth-* Cookie → SPA 入口页
      ── POST /api/… ─────────────► 官方 dsh-auth 校验（无 Cookie 即 401）
                                    ▼
                          [数据闸门] `connection/request` waterfall：
                          每条请求再证认证会话，否则 401
```

- **第一层 —— 认证框架会话 Cookie**（`dsh-login.*`）：`HttpOnly`、`SameSite=Strict`，仅当监听器走 TLS 时带 `Secure`，时长为 `sessionDays`。具名用户身份，持久化在 sqlite 数据库中，重启不丢。
- **第二层 —— 官方 `dsh-auth-*` Cookie**：只由 `authorizeIndex` 铸出，而本插件仅在认证会话有效后才调用它。其生成与校验逻辑属于官方包，未做任何修改。

框架侧（挂载于 `/auth`）承载设计的完整核心契约：业务逻辑前的来源校验与限流、敏感端点读权威源、等时登录失败、重置令牌原子核销、会话续期节流——见 `plugins/auth/design` 与 `@veren/auth-core` 的 README。

The framework side (mounted at `/auth`) carries the design's full core contract: origin checks and rate limiting before business logic, sensitive-session reads from the authority, equal-time sign-in failures, atomic reset-token consumption, and session refresh throttling — see `plugins/auth/design` and the `@veren/auth-core` README.

## 组合点 / Composition points

在空闲位上注册 `webServer` 命名路由（`exact /`、`exact /index.html`、`exact /login`、`prefix /auth`）；使用 `ctx.connection.authorizeIndex()` / `authenticatedUrl()`；用 `connection/request` waterfall 做数据闸门；秘密存 `ctx.credentials`；持久化用 `@veren/orm`（sqlite 驱动）；认证框架用 `@veren/auth-core`。不修改任何官方包代码，也不注册官方已占用的路径（`/api`、`/connect` 等）。

Named `webServer` routes on the free seats; `ctx.connection` for the exchange and the data gate; `ctx.credentials` for the signing secret; `@veren/orm` (sqlite driver) for durable state; `@veren/auth-core` as the framework. No official package code is modified; no officially owned route is registered.

## 配置 / Configuration

| 字段 | 默认 | 含义 |
|---|---|---|
| `distIndex` | 自动 | 前端 dist 根内 `index.html` 的绝对路径；省略时插件定位运行中 runtime 的 `@deepseek-ai/dsh-web-frontend`。 |
| `publicOrigin` | — | 缺少 `webServer.getOrigin()`/`protocol` 的宿主构建的显式 origin 覆盖。 |
| `sessionDays` | `7` | 会话时长（天，1–365）。 |
| `rateLimit.window` / `rateLimit.max` | `60` / `10` | 暴力尝试防护窗口/上限。框架专属规则（`/sign-in*` 等 10 秒 3 次、`/request-password-reset` 等 60 秒 3 次）优先；本配置调节兜底规则。 |
| `admin.email` / `admin.password` / `admin.name` | — | 首次运行管理员种子，只消费一次——落库的是 scrypt 哈希，之后的重启不再读取该配置。 |
| `database.file` | `<DSH_HOME>/storages/web_login_gate/auth.db` | sqlite 数据库文件绝对路径。 |

配置非法时加载显式失败：数据库打不开、签名秘密缺失、缺失 `distIndex` 都会中止启动——Web 服务器绝不降级为无门禁状态。

Misconfiguration fails loud at load: an unopenable database, a missing signing secret, or a missing `distIndex` all abort the boot — the web server never degrades to an ungated state.

### profile patch 示例 / Example

见 [cordis.patch.yml](./cordis.patch.yml)。它在已知 dist 锚点后插入插件行。

See [cordis.patch.yml](./cordis.patch.yml).

## WebSocket 间接保护的原理与前提 / WebSocket protection premise

`/api/remote.mux` 的 WebSocket 升级不被本插件直接拦截，而是**间接**保护：网关要求官方 `dsh-auth-*` Cookie，而该 Cookie 只能在 `/` 的 token 兑换中铸出——本插件只对持有效认证会话的浏览器开放这一步。前提因此是：不先登录就拿不到进程 launch token。该 token 仍由官方启动器打印在控制台，且 `/connect`（官方路由，不修改官方代码就无法拦截）仍然接受它——能接触控制台的人在信任边界之内。若必须硬性闸住升级路由，需要官方在该处提供扩展点。

The `/api/remote.mux` upgrade is protected **indirectly**: the gateway requires the official `dsh-auth-*` cookie, which can only be minted by the exchange this plugin opens solely to browsers holding a valid auth session. Premise: nobody obtains the launch token without signing in first.

## 已知边界 / Known boundaries

- **静态资源保持公开**（官方设计）：dist 根下的 JS/CSS 由 `frontend-static` 无认证提供；只有入口 HTML（`/`、`/index.html`）被闸住。SPA 的实质性操作都走 `/api`，由数据闸门保护。Static assets stay public by official design; only the entry HTML is gated.
- **SPA 深链**：官方 fallback 对未知路径返回 404，SPA 挂载在 `/`，正是被闸的入口。
- **无角色**：本期只区分登录/未登录；多租户与角色控制（设计的组织域）留待后续。No roles yet; the design's organization domain is future work.
- 签名秘密经 `ctx.credentials` 一次性持久化（`web-login-gate/auth-core-secret`）。删除该凭据记录会轮换秘密：所有会话失效，用户重新登录即可——不会出现重定向死循环。Deleting the credential record rotates the secret; sessions invalidate and users sign in again — no redirect loop.

## 3.0.0-rc.1 存储迁移说明 / storage migration note

持久层已从 `web_login_gate` 存储域（Better Auth + Kysely dialect）迁到由自建 `@veren/auth-core` 框架驱动的 `@veren/orm` sqlite 数据库（依 `plugins/auth/design` 的重构）。既有 domain 记录**不做迁移**：首次启动会重新播种配置的 `admin`，用户需重新注册。因此本版按主版本预发布号发放。

The persistence layer moved from the storage domain to a `@veren/orm` sqlite database driven by the self-built `@veren/auth-core` framework. Existing records are **not** migrated; the admin seeds again on first start. Hence the MAJOR pre-release version.

## 开发 / Development

```sh
pnpm install
pnpm build   # tsc
pnpm test    # vitest: 门禁处理器、auth-kit 闭环、数据库持久性
```

布局：`src/database.ts`（@veren/orm sqlite DataSource）· `src/auth-kit.ts`（框架装配 + 管理员播种）· `src/secret.ts`（签名秘密经凭据服务）· `src/gate.ts`（路由 + 数据闸门）· `src/login-page.ts`（公开登录页）· `src/index.ts`（插件入口）。
