# @veren/web-login-gate

Login gate for the dsh Web GUI, built on the `@veren/auth-core` framework (design document: `plugins/auth/design`). Only a browser that signed in with an email + password reaches the SPA entry or any `/api` request; the anonymous per-process launch-token gate stays untouched underneath.

Use this plugin when a dsh Web deployment needs named users instead of "anyone holding the launch URL". Skip it when the single anonymous browser identity is enough, or when a reverse proxy already owns authentication (this plugin is not designed to sit behind a proxy that rewrites Host/Cookie).

dsh Web GUI 的登录门禁，构建在 `@veren/auth-core` 认证框架之上（设计文档：`plugins/auth/design`）。只有以邮箱+密码登录成功的浏览器才能到达 SPA 入口或任何 `/api` 请求；底层的匿名进程级 launch token 机制原样保留。当部署需要具名用户（而非"持有启动 URL 的任何人"）时使用本插件；单一匿名浏览器身份够用，或反代已负责认证时不要使用（本插件不支持部署在会改写 Host/Cookie 的多层反代之后）。

## Architecture / 架构

Two independent cookie layers, two independent gates / 两层相互独立的 Cookie，两道相互独立的闸门：

```
Browser ── GET /login ──────────────► public login page (this plugin)
        ── POST /auth/sign-in/email ► auth framework (this plugin, /auth prefix route)
                                      │ users/sessions/accounts/verification
                                      │ in the @veren/orm sqlite database
                                      │ (<DSH_HOME>/storages/web_login_gate/auth.db)
        ── GET /?token=… ───────────► [gate] auth session? ── no ──► 303 /login (no dsh-auth-* cookie!)
                                      │ yes
                                      ▼
                            ctx.connection.authorizeIndex()
                                      │ mints the official signed
                                      ▼
                            dsh-auth-* cookie + 303 to clean /
        ── GET / ───────────────────► [gate] session + dsh-auth-* cookie → SPA index
        ── POST /api/… ─────────────► official dsh-auth check (401 without cookie)
                                      ▼
                            [data gate] `connection/request` waterfall:
                            re-proves the auth session, else 401
```

- **Layer 1 — framework session cookie** (`dsh-login.*`): HttpOnly, `SameSite=Strict`, `Secure` iff the listener serves TLS, lifetime = `sessionDays`. Identity of a named user, persisted in the sqlite database, survives restarts.
- **Layer 2 — official `dsh-auth-*` cookie**: minted only by `authorizeIndex`, which this plugin calls **only after** a valid auth session. Its generation and verification are the official packages' code, unmodified.

**第一层** —— 认证框架会话 Cookie（`dsh-login.*`）：HttpOnly、`SameSite=Strict`，仅当监听器走 TLS 时带 `Secure`，时长为 `sessionDays`。具名用户身份，持久化在 sqlite 数据库中，重启不丢。**第二层** —— 官方 `dsh-auth-*` Cookie：只由 `authorizeIndex` 铸出，而本插件仅在认证会话有效后才调用它。其生成与校验逻辑属于官方包，未做任何修改。

The framework side (mounted at `/auth`) carries the design's full core contract: origin checks and rate limiting before business logic, sensitive-session reads from the authority, equal-time sign-in failures, atomic reset-token consumption, and session refresh throttling — see `plugins/auth/design` and the `@veren/auth-core` README.

框架侧（挂载于 `/auth`）承载设计的完整核心契约：业务逻辑前的来源校验与限流、敏感端点读权威源、等时登录失败、重置令牌原子核销、会话续期节流——见 `plugins/auth/design` 与 `@veren/auth-core` 的 README。

## Composition points / 组合点

`webServer` named routes on the free seats `exact /`, `exact /index.html`, `exact /login`, `prefix /auth`; `ctx.connection.authorizeIndex()` / `authenticatedUrl()`; the `connection/request` waterfall (data gate); `ctx.credentials` (the signing secret); `@veren/orm` (sqlite driver) for durable state; `@veren/auth-core` as the authentication framework. No official package code is modified; no route the official plugins own (`/api`, `/connect`, …) is registered.

在空闲位上注册 `webServer` 命名路由（`exact /`、`exact /index.html`、`exact /login`、`prefix /auth`）；使用 `ctx.connection.authorizeIndex()` / `authenticatedUrl()`；用 `connection/request` waterfall 做数据闸门；秘密存 `ctx.credentials`；持久化用 `@veren/orm`（sqlite 驱动）；认证框架用 `@veren/auth-core`。不修改任何官方包代码，也不注册官方已占用的路径（`/api`、`/connect` 等）。

## Configuration / 配置

| Field | Default | Meaning / 含义 |
|---|---|---|
| `distIndex` | auto | Absolute path of `index.html` inside the frontend dist root; omitted, the plugin resolves the running runtime's `@deepseek-ai/dsh-web-frontend`. 前端 dist 根内 `index.html` 的绝对路径；省略时插件定位运行中 runtime 的 `@deepseek-ai/dsh-web-frontend`。 |
| `publicOrigin` | — | Listener origin override for host builds without `webServer.getOrigin()`/`protocol`. 缺少这两个 getter 的宿主构建的显式 origin 覆盖。 |
| `sessionDays` | `7` | Session lifetime in days (1–365). 会话时长（天）。 |
| `rateLimit.window` / `rateLimit.max` | `60` / `10` | Brute-force window/limit. Framework special rules (`/sign-in*` etc. at 10s/3, `/request-password-reset` etc. at 60s/3) take precedence; this config tunes the fallback rule. 暴力尝试防护窗口/上限。框架专属规则（`/sign-in*` 等 10 秒 3 次、`/request-password-reset` 等 60 秒 3 次）优先；本配置调节兜底规则。 |
| `admin.email` / `admin.password` / `admin.name` | — | First-run administrator seed. Consumed once — the stored account is the scrypt hash, so later restarts never read this config. 首次运行管理员种子，只消费一次——落库的是 scrypt 哈希，之后的重启不再读取该配置。 |
| `database.file` | `<DSH_HOME>/storages/web_login_gate/auth.db` | Absolute sqlite database file path. sqlite 数据库文件绝对路径。 |

Misconfiguration fails loud at load: an unopenable database, a missing signing secret, or a missing `distIndex` all abort the boot — the web server never degrades to an ungated state.

配置非法时加载显式失败：数据库打不开、签名秘密缺失、缺失 `distIndex` 都会中止启动——Web 服务器绝不降级为无门禁状态。

### Example profile patch / profile patch 示例

See [cordis.patch.yml](./cordis.patch.yml). It inserts the plugin row after `frontend-static`'s dist anchor is known.

见 [cordis.patch.yml](./cordis.patch.yml)。它在已知 dist 锚点后插入插件行。

## WebSocket protection premise / WebSocket 间接保护的原理与前提

The `/api/remote.mux` WebSocket upgrade is not intercepted by this plugin. It is protected **indirectly**: the gateway requires the official `dsh-auth-*` cookie, and that cookie can only be minted by the launch-token exchange at `/`, which this plugin only reaches for browsers holding a valid auth session. The premise, therefore: nobody obtains the process launch token without first signing in. The token is still printed in the console by the official launcher and is still accepted at `/connect` (official route, not interceptable without modifying official code) — a person with console access is within the trust boundary. If a hard gate on the upgrade route is ever required, it needs an official extension point there.

`/api/remote.mux` 的 WebSocket 升级不被本插件直接拦截，而是**间接**保护：网关要求官方 `dsh-auth-*` Cookie，而该 Cookie 只能在 `/` 的 token 兑换中铸出——本插件只对持有效认证会话的浏览器开放这一步。前提因此是：不先登录就拿不到进程 launch token。该 token 仍由官方启动器打印在控制台，且 `/connect`（官方路由，不修改官方代码就无法拦截）仍然接受它——能接触控制台的人在信任边界之内。若必须硬性闸住升级路由，需要官方在该处提供扩展点。

## Known boundaries / 已知边界

- **Static assets stay public** (official design): JS/CSS under the dist root are served by `frontend-static` without authentication. Only the entry HTML (`/`, `/index.html`) is gated. Everything the SPA does of consequence goes through `/api`, which the data gate protects. 静态资源保持公开（官方设计）：dist 根下的 JS/CSS 由 `frontend-static` 无认证提供；只有入口 HTML（`/`、`/index.html`）被闸住。SPA 的实质性操作都走 `/api`，由数据闸门保护。
- **SPA deep links**: the official `frontend-static` fallback 404s unknown paths; the SPA mounts at `/`, which is exactly the gated entry. 官方 fallback 对未知路径返回 404，SPA 挂载在 `/`，正是被闸的入口。
- **No roles**: this release distinguishes only logged-in vs. anonymous; multi-tenant/role control is future work (the design's organization domain). 本期只区分登录/未登录；多租户与角色控制（设计的组织域）留待后续。
- The signing secret is persisted once via `ctx.credentials` (`web-login-gate/auth-core-secret`). Deleting that credential record rotates the secret: all sessions become invalid and users simply sign in again — no redirect loop. 签名秘密经 `ctx.credentials` 一次性持久化（`web-login-gate/auth-core-secret`）。删除该凭据记录会轮换秘密：所有会话失效，用户重新登录即可——不会出现重定向死循环。

## 3.0.0-rc.1 — storage migration note / 存储迁移说明

The persistence layer moved from the `web_login_gate` storage domain (Better Auth + Kysely dialect) to a `@veren/orm` sqlite database driven by the self-built `@veren/auth-core` framework, per the `plugins/auth/design` refactor. Existing domain records are **not** migrated: on first start the gate seeds the configured `admin` again and users sign up anew. This is why the release carries a MAJOR pre-release version.

持久层已从 `web_login_gate` 存储域（Better Auth + Kysely dialect）迁到由自建 `@veren/auth-core` 框架驱动的 `@veren/orm` sqlite 数据库（依 `plugins/auth/design` 的重构）。既有 domain 记录**不做迁移**：首次启动会重新播种配置的 `admin`，用户需重新注册。因此本版按主版本预发布号发放。

## Development / 开发

```sh
pnpm install
pnpm build   # tsc
pnpm test    # vitest: gate handlers, auth-kit closed loop, database durability
```

Layout: `src/database.ts` (`@veren/orm` sqlite DataSource) · `src/auth-kit.ts` (framework assembly + admin seed) · `src/secret.ts` (signing secret via credentials) · `src/gate.ts` (routes + data gate) · `src/login-page.ts` (public page) · `src/index.ts` (plugin entry).
