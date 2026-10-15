# @veren/web-login-gate

dsh Web GUI 的 Better Auth 登录门禁。只有以邮箱+密码登录成功的浏览器才能到达 SPA 入口或任何 `/api` 请求；底层的匿名进程级 launch token 机制原样保留。

当 dsh Web 部署需要具名用户（而非"持有启动 URL 的任何人"）时使用本插件。单一匿名浏览器身份够用，或反代已负责认证时不要使用（本插件不支持部署在会改写 Host/Cookie 的多层反代之后）。

Better Auth login gate for the dsh Web GUI. Only a browser that signed in with an email + password reaches the SPA entry or any `/api` request; the anonymous per-process launch-token gate stays untouched underneath.

Use this plugin when a dsh Web deployment needs named users instead of "anyone holding the launch URL". Skip it when the single anonymous browser identity is enough, or when a reverse proxy already owns authentication (this plugin is not designed to sit behind a proxy that rewrites Host/Cookie).

## 架构 / Architecture

两层相互独立的 Cookie，两道相互独立的闸门 / Two independent cookie layers, two independent gates:

```
浏览器 ── GET /login ──────────────► 公开登录页（本插件）
      ── POST /auth/sign-in/email ► Better Auth（本插件，/auth 前缀路由）
                                    │ users/sessions/accounts/verification
                                    │ 存于 domain `web_login_gate`
                                    │ （json 或 sqlite，经 storage group 路由）
      ── GET /?token=… ───────────► [门禁] 有 Better Auth 会话？── 无 ──► 303 /login（绝不铸 dsh-auth-* Cookie！）
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
                          再次证明 Better Auth 会话，否则 401
```

- **第一层 —— Better Auth 会话 Cookie**（`dsh-login.*`）：`HttpOnly`、`SameSite=Strict`，仅当 `webServer.protocol === 'https:'` 时带 `Secure`，时长为 `sessionDays`。具名用户身份，持久化在 domain 中，重启不丢。
- **第二层 —— 官方 `dsh-auth-*` Cookie**：只由 `authorizeIndex` 铸出，而本插件仅在 Better Auth 会话有效后才调用它。其生成与校验逻辑属于官方包，未做任何修改。

**Layer 1** — the Better Auth session cookie: HttpOnly, `SameSite=Strict`, `Secure` iff `webServer.protocol === 'https:'`, lifetime `sessionDays`; a named user's identity, persisted in the domain across restarts. **Layer 2** — the official `dsh-auth-*` cookie, minted only by `authorizeIndex`, which this plugin calls only after a valid Better Auth session; its code is official and unmodified.

## 组合点 / Composition points

在空闲位上注册 `webServer` 命名路由（`exact /`、`exact /index.html`、`exact /login`、`prefix /auth`）；使用 `ctx.connection.authorizeIndex()` / `authenticatedUrl()`；用 `connection/request` waterfall 做数据闸门；秘密存 `ctx.credentials`（Better Auth 签名秘密）；用 `ctx.storageDomain.open()` 打开自声明的 `web_login_gate` domain。不修改任何官方包代码，也不注册官方已占用的路径（`/api`、`/connect` 等）。

Named `webServer` routes on the free seats (`exact /`, `exact /index.html`, `exact /login`, `prefix /auth`); `ctx.connection.authorizeIndex()` / `authenticatedUrl()`; the `connection/request` waterfall as the data gate; `ctx.credentials` for the Better Auth signing secret; `ctx.storageDomain.open()` over the self-declared `web_login_gate` domain. No official package code is modified; no officially owned route is registered.

## 配置 / Configuration

| 字段 | 默认 | 含义 |
|---|---|---|
| `distIndex` | —（必填） | 前端 dist 根内 `index.html` 的绝对路径，与 `frontend-static` 接收的锚点相同。 |
| `sessionDays` | `7` | Better Auth 会话时长（天，1–365）。 |
| `rateLimit.window` / `rateLimit.max` | `60` / `10` | 登录限流（暴力尝试防护）：每 `window` 秒最多 `max` 次尝试。 |
| `admin.email` / `admin.password` / `admin.name` | — | 首次运行管理员种子，只消费一次——落库的是密码哈希，之后的重启不再读取该配置。 |
| `storage.backend` / `storage.routes` | `json` / `{}` | 存储路由意向，遵循 storage group 的 `backend`/`routes` 形态。插件校验每个名字都是已注册后端，否则显式失败；真正的路由决策仍由 `storage-domain` 行拥有。 |

配置非法时加载显式失败：未注册的存储后端、domain 打开失败（`already-open`、`invalid-record` 等）、缺失 `distIndex` 都会中止启动——Web 服务器绝不降级为无门禁状态。

Misconfiguration fails loud at load: an unregistered storage backend, a failing domain open, or a missing `distIndex` all abort the boot — the web server never degrades to an ungated state.

### profile patch 示例 / Example profile patch

见 / see [cordis.patch.yml](./cordis.patch.yml)。它在已知 dist 锚点后插入插件行，并（可选）通过 `storage-domain` 行的 `routes` 把 `web_login_gate` domain 路由到指定后端。

## WebSocket 间接保护的原理与前提 / WebSocket protection premise

`/api/remote.mux` 的 WebSocket 升级不被本插件直接拦截，而是**间接**保护：网关要求官方 `dsh-auth-*` Cookie，而该 Cookie 只能在 `/` 的 token 兑换中铸出——本插件只对持有效 Better Auth 会话的浏览器开放这一步。前提因此是：不先登录就拿不到进程 launch token。该 token 仍由官方启动器打印在控制台，且 `/connect`（官方路由，不修改官方代码就无法拦截）仍然接受它——能接触控制台的人在信任边界之内。若必须硬性闸住升级路由，需要官方在该处提供扩展点。

The `/api/remote.mux` upgrade is protected **indirectly**: the gateway requires the official `dsh-auth-*` cookie, which can only be minted by the exchange this plugin opens solely to browsers holding a valid Better Auth session. Premise: nobody obtains the launch token without signing in first. The token is still printed by the official launcher and still accepted at `/connect` (official route, not interceptable without official changes) — console access is within the trust boundary.

## 已知边界 / Known boundaries

- **静态资源保持公开**（官方设计）：dist 根下的 JS/CSS 由 `frontend-static` 无认证提供；只有入口 HTML（`/`、`/index.html`）被闸住。SPA 的实质性操作都走 `/api`，由数据闸门保护。Static assets stay public (official design); only the entry HTML is gated, and everything consequential goes through the gated `/api`.
- **SPA 深链**：官方 `frontend-static` fallback 对未知路径返回 404，SPA 挂载在 `/`，正是被闸的入口。The SPA mounts at `/` — exactly the gated entry.
- **无角色**：本期只区分登录/未登录；多租户与角色控制留待后续。Only logged-in vs. anonymous in this release; roles are future work.
- Better Auth 秘密经 `ctx.credentials` 一次性持久化（`web-login-gate/better-auth-secret`）。删除该凭据记录会轮换秘密：所有 Better Auth 会话失效，用户重新登录即可——不会出现重定向死循环。Deleting the credential record rotates the secret; sessions invalidate and users sign in again — no redirect loop.

## 开发 / Development

```sh
pnpm install
pnpm build   # tsc
pnpm test    # vitest：适配器语义、Better Auth 流程、门禁处理器
```

布局：`src/domain.ts`（domain 声明）· `src/adapter.ts`（基于 `KvTable` 的 Better Auth 适配器）· `src/auth.ts`（凭据秘密、Better Auth 实例、管理员种子）· `src/gate.ts`（路由 + 数据闸门）· `src/login-page.ts`（公开登录页）· `src/index.ts`（插件入口）。
