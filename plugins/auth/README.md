# @veren/web-login-gate

Better Auth login gate for the dsh Web GUI. Only a browser that signed in with an email + password reaches the SPA entry or any `/api` request; the anonymous per-process launch-token gate stays untouched underneath.

Use this plugin when a dsh Web deployment needs named users instead of "anyone holding the launch URL". Skip it when the single anonymous browser identity is enough, or when a reverse proxy already owns authentication (this plugin is not designed to sit behind a proxy that rewrites Host/Cookie).

dsh Web GUI 的 Better Auth 登录门禁。只有以邮箱+密码登录成功的浏览器才能到达 SPA 入口或任何 `/api` 请求；底层的匿名进程级 launch token 机制原样保留。当部署需要具名用户（而非"持有启动 URL 的任何人"）时使用本插件；单一匿名浏览器身份够用，或反代已负责认证时不要使用（本插件不支持部署在会改写 Host/Cookie 的多层反代之后）。

## Architecture / 架构

Two independent cookie layers, two independent gates / 两层相互独立的 Cookie，两道相互独立的闸门：

```
Browser ── GET /login ──────────────► public login page (this plugin)
        ── POST /auth/sign-in/email ► Better Auth (this plugin, /auth prefix route)
                                      │ users/sessions/accounts/verification
                                      │ in domain `web_login_gate`
                                      │ (json or sqlite, via the storage group)
        ── GET /?token=… ───────────► [gate] Better Auth session? ── no ──► 303 /login (no dsh-auth-* cookie!)
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
                            re-proves the Better Auth session, else 401
```

- **Layer 1 — Better Auth session cookie** (`dsh-login.*`): HttpOnly, `SameSite=Strict`, `Secure` iff `webServer.protocol === 'https:'`, lifetime = `sessionDays`. Identity of a named user, persisted in the domain, survives restarts.
- **Layer 2 — official `dsh-auth-*` cookie**: minted only by `authorizeIndex`, which this plugin calls **only after** a valid Better Auth session. Its generation and verification are the official packages' code, unmodified.

**First layer** — Better Auth 会话 Cookie（`dsh-login.*`）：HttpOnly、`SameSite=Strict`，仅当 `webServer.protocol === 'https:'` 时带 `Secure`，时长为 `sessionDays`。具名用户身份，持久化在 domain 中，重启不丢。**第二层** —— 官方 `dsh-auth-*` Cookie：只由 `authorizeIndex` 铸出，而本插件仅在 Better Auth 会话有效后才调用它。其生成与校验逻辑属于官方包，未做任何修改。

## Composition points / 组合点

`webServer` named routes on the free seats `exact /`, `exact /index.html`, `exact /login`, `prefix /auth`; `ctx.connection.authorizeIndex()` / `authenticatedUrl()`; the `connection/request` waterfall (data gate); `ctx.credentials` (the Better Auth signing secret); `ctx.storageDomain.open()` with the self-declared `web_login_gate` domain. No official package code is modified; no route the official plugins own (`/api`, `/connect`, …) is registered.

在空闲位上注册 `webServer` 命名路由（`exact /`、`exact /index.html`、`exact /login`、`prefix /auth`）；使用 `ctx.connection.authorizeIndex()` / `authenticatedUrl()`；用 `connection/request` waterfall 做数据闸门；秘密存 `ctx.credentials`；用 `ctx.storageDomain.open()` 打开自声明的 `web_login_gate` domain。不修改任何官方包代码，也不注册官方已占用的路径（`/api`、`/connect` 等）。

## Configuration / 配置

| Field | Default | Meaning / 含义 |
|---|---|---|
| `distIndex` | — (required) | Absolute path of `index.html` inside the frontend dist root — the same anchor `frontend-static` receives. 前端 dist 根内 `index.html` 的绝对路径，与 `frontend-static` 相同的锚点。 |
| `sessionDays` | `7` | Better Auth session lifetime in days (1–365). 会话时长（天）。 |
| `rateLimit.window` / `rateLimit.max` | `60` / `10` | Sign-in rate limit (brute-force protection): `max` attempts per `window` seconds. 登录限流（暴力尝试防护）：每 `window` 秒最多 `max` 次。 |
| `admin.email` / `admin.password` / `admin.name` | — | First-run administrator seed. Consumed once — the stored account is the password hash, so later restarts never read this config. 首次运行管理员种子，只消费一次——落库的是密码哈希，之后的重启不再读取该配置。 |
| `storage.backend` / `storage.routes` | `json` / `{}` | Storage routing intent in the storage group's `backend`/`routes` shape. The plugin validates every name is a registered backend and fails loud otherwise; the actual routing decision stays with the `storage-domain` row. 存储路由意向，遵循 storage group 的 `backend`/`routes` 形态。插件校验每个名字都是已注册后端，否则显式失败；真正的路由决策仍由 `storage-domain` 行拥有。 |

Misconfiguration fails loud at load: an unregistered storage backend, a failing domain open (`already-open`, `invalid-record`, …), or a missing `distIndex` all abort the boot — the web server never degrades to an ungated state.

配置非法时加载显式失败：未注册的存储后端、domain 打开失败（`already-open`、`invalid-record` 等）、缺失 `distIndex` 都会中止启动——Web 服务器绝不降级为无门禁状态。

### Example profile patch / profile patch 示例

See [cordis.patch.yml](./cordis.patch.yml). It inserts the plugin row after `frontend-static`'s dist anchor is known, and (optionally) routes the `web_login_gate` domain to a chosen backend via the `storage-domain` row's `routes` map.

见 [cordis.patch.yml](./cordis.patch.yml)。它在已知 dist 锚点后插入插件行，并（可选）通过 `storage-domain` 行的 `routes` 把 `web_login_gate` domain 路由到指定后端。

## WebSocket protection premise / WebSocket 间接保护的原理与前提

The `/api/remote.mux` WebSocket upgrade is not intercepted by this plugin. It is protected **indirectly**: the gateway requires the official `dsh-auth-*` cookie, and that cookie can only be minted by the launch-token exchange at `/`, which this plugin only reaches for browsers holding a valid Better Auth session. The premise, therefore: nobody obtains the process launch token without first signing in. The token is still printed in the console by the official launcher and is still accepted at `/connect` (official route, not interceptable without modifying official code) — a person with console access is within the trust boundary. If a hard gate on the upgrade route is ever required, it needs an official extension point there.

`/api/remote.mux` 的 WebSocket 升级不被本插件直接拦截，而是**间接**保护：网关要求官方 `dsh-auth-*` Cookie，而该 Cookie 只能在 `/` 的 token 兑换中铸出——本插件只对持有效 Better Auth 会话的浏览器开放这一步。前提因此是：不先登录就拿不到进程 launch token。该 token 仍由官方启动器打印在控制台，且 `/connect`（官方路由，不修改官方代码就无法拦截）仍然接受它——能接触控制台的人在信任边界之内。若必须硬性闸住升级路由，需要官方在该处提供扩展点。

## Known boundaries / 已知边界

- **Static assets stay public** (official design): JS/CSS under the dist root are served by `frontend-static` without authentication. Only the entry HTML (`/`, `/index.html`) is gated. Everything the SPA does of consequence goes through `/api`, which the data gate protects. 静态资源保持公开（官方设计）：dist 根下的 JS/CSS 由 `frontend-static` 无认证提供；只有入口 HTML（`/`、`/index.html`）被闸住。SPA 的实质性操作都走 `/api`，由数据闸门保护。
- **SPA deep links**: the official `frontend-static` fallback 404s unknown paths; the SPA mounts at `/`, which is exactly the gated entry. 官方 fallback 对未知路径返回 404，SPA 挂载在 `/`，正是被闸的入口。
- **No roles**: this release distinguishes only logged-in vs. anonymous; multi-tenant/role control is future work. 本期只区分登录/未登录；多租户与角色控制留待后续。
- The Better Auth secret is persisted once via `ctx.credentials` (`web-login-gate/better-auth-secret`). Deleting that credential record rotates the secret: all Better Auth sessions become invalid and users simply sign in again — no redirect loop. Better Auth 秘密经 `ctx.credentials` 一次性持久化（`web-login-gate/better-auth-secret`）。删除该凭据记录会轮换秘密：所有 Better Auth 会话失效，用户重新登录即可——不会出现重定向死循环。

## Development / 开发

```sh
pnpm install
pnpm build   # tsc
pnpm test    # vitest: adapter semantics, Better Auth flows, gate handlers
```

Layout: `src/domain.ts` (domain spec) · `src/adapter.ts` (Better Auth adapter over `KvTable`) · `src/auth.ts` (secret via credentials, Better Auth instance, admin seed) · `src/gate.ts` (routes + data gate) · `src/login-page.ts` (public page) · `src/index.ts` (plugin entry).
