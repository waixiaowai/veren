# DSH Admin Platform (P0)

English | [中文](admin-platform.cn.md)

The admin platform is a set of DSH plugins that turn one profile into a generic
back-office: capability contracts, a provider kernel, a unified API gateway, and a
replaceable browser UI. Everything a consumer touches is a contract; every
implementation is a provider behind a façade.

This guide covers what ships today, how to install it, how to extend it, and what
the implementation deliberately does not do yet.

## Architecture

```text
                 ┌──────────── Browser SPA (/admin) ────────────┐
                 │  packs: shell / theme / locale / icons / page │
                 └───────────────┬──────────────────────────────┘
                     same-origin ESM + /api/* JSON
┌────────────────────────────────▼───────────────────────────────┐
│ admin-web          shell, assets, UI pack files, bootstrap      │
│ admin-ui-kernel    pack registry, manifests, asset containment   │
├─────────────────────────────────────────────────────────────────┤
│ admin-api-kernel   one pipeline: auth → CSRF → perms → audit     │
├─────────────────────────────────────────────────────────────────┤
│ admin-kernel       registry, negotiation, façades, boot gate     │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│ data-kv  │ auth     │ access   │ nav      │ audit / docs        │
└──────────┴──────────┴──────────┴──────────┴─────────────────────┘
                   DSH storage domain (profile's storage group)
```

## Packages

| Package | Role |
|---|---|
| `@veren/admin-contract` | Stable Host types: capabilities, errors, data port, route vocabulary, capability interfaces |
| `@veren/admin-kernel` | Provider registry, priority/version negotiation, façades, catalog, health, boot gate |
| `@veren/admin-api-kernel` | The one HTTP gateway: auth, CSRF, permissions, limits, validation, audit, OpenAPI |
| `@veren/admin-data-dsh-kv` | `data` over one DSH storage domain (degraded transactions) |
| `@veren/admin-auth-local` | `auth`: setup, login, sessions, users, API tokens |
| `@veren/admin-access-rbac` | `access`: built-in + custom roles, bindings, anti-lockout |
| `@veren/admin-navigation-default` | `navigation`: default menu contributions |
| `@veren/admin-audit-default` | `audit`: append-only trail, retention, cursor paging |
| `@veren/admin-docs-openapi` | `docs`: catalog, backend health, OpenAPI, docs index |
| `@veren/admin-ui-contract` | Browser pack/runtime contract |
| `@veren/admin-ui-kernel` | Pack registry, per-audience manifests, asset serving rules |
| `@veren/admin-web` | SPA carrier, bootstrap, static containment, boot gate |
| `@veren/admin-app` | Bundle patch composing every row above |

## Request lifecycle

1. `admin-api-kernel` matches `/api/<audience>/v1<path>` and assigns a request id.
2. Origin and preflight checks run before anything else.
3. Rate limiting (fixed window per ip + route).
4. Body size and JSON parsing; validation of `query`, then `input`.
5. Authentication: `admin_session` cookie or `Authorization: Bearer`.
6. CSRF double submit for unsafe non-public methods.
7. Permission and scope enforcement, resolved from the principal.
8. Audit intent → handler → audit outcome (best effort).
9. JSON response with `no-store` and `nosniff`.

Failures always render `{ error: { code, message, details?, requestId } }`; the
code maps to a fixed HTTP status.

## The data path

`api.adminData` exposes `table<T>(name)` with synchronous `find`/`list`/`size`
and asynchronous `save`/`remove`. The embedded adapter stores every collection in
one DSH storage domain (`admin_data`, one `records` table, keys
`<collection>:<id>`) and reports `features.transactions = false`.

`transaction(work)` serializes work through one promise chain so concurrent
transactions never interleave, but it does **not** roll back: a failure leaves
earlier writes in place and propagates the error. Anything needing atomicity
should run on a SQL engine.

## Install

```bash
dsh plugin --profile admin add @veren/admin-app
dsh --profile admin --host 127.0.0.1 --port 3081 --no-open
```

The profile must provide `webServer`, `storage` (with at least one backend) and
`storageDomain`. `admin-data-dsh-kv` defaults to `{ backend: 'json' }`; set
`storage.backend` on its row when the profile names the backend differently. A
missing backend fails the load loudly, naming it and the registered names.

Open `/admin`, complete the first-run setup, and the dashboard appears.

## Replace a provider or a UI pack

```yaml
- id: admin-theme-default
  disabled: true
- id: my-brand-theme
  name: '@acme/admin-theme-brand'
```

A replacement provider must declare a **different** priority for the same
capability; two equal priorities are refused, so the active implementation is
never ambiguous. Consumers keep the same façade, so no business code changes.

## Add a capability or a module

1. Declare the capability interface in `@veren/admin-contract` (a provider
   without a contract cannot be consumed).
2. Implement it and register with `ctx.admin.register(manifest, implementation)`
   inside `ctx.effect`.
3. Expose it to consumers through a façade mounted by the kernel, or call
   `ctx.admin.require<YourCap>(name)` directly.
4. Register HTTP routes with `ctx.adminApi.register`, naming the permission it
   needs and whether it is audited.

## Security model

- Server-side permissions on every route; hiding UI is never authorization.
- CSRF double submit on every unsafe non-public method.
- Cookies are `HttpOnly` + `SameSite=Lax`; `secureCookies` must be enabled behind
  TLS.
- Passwords use scrypt; session and token secrets are stored hashed only.
- The SPA shell carries a strict CSP; packs are same-origin ESM data.
- Audit is append-only by policy; the embedded store is not WORM.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/<package>
pnpm check:plugins
```

The bundle package runs a full-stack composition test: setup → login →
bootstrap → user management → audit → catalog over a real HTTP server with the
real providers.

## Implementation vs. the design document

The design document (`admin-system-design.cn.md`) describes P0–P3; this code is a
P0 slice, and some details intentionally differ:

| Design | Implementation |
|---|---|
| Providers discovered from `package.json` `dsh.admin.provider` / `dsh.admin.ui` | Providers and packs self-register through `ctx.admin.register` / `ctx.adminUi.register` |
| `auth-better` + `data-drizzle` (SQLite default) | `auth-local` + `data-dsh-kv`; SQL adapters are follow-up work |
| `/api/openapi.json` | `/api/public/v1/openapi.json` (audience-prefixed routing) |
| `Idempotency-Key` support | Not implemented; CORS only advertises the header |
| Setup token with TTL | Setup is open while no user exists |
| `ctx.admin.registerModule(descriptor)` | Modules register routes and navigation directly |
| Provider hot-swap with drain + rollback | Live priority swap without drain; no automatic rollback |
| Collections `auth_users`, `access_roles`, `audit_entries`, … | `admin_users`, `admin_roles`, `admin_audit`, … |

## Deferred to P1 and later

Tasks, forms, AI assist, attachments, notifications, background jobs and settings
providers; SQL (Drizzle) and MongoDB adapters with real transactions; provider
drain/rollback; package-declaration scanning for providers and UI packs; API
tokens scoped to terminal routes end-to-end; password reset and MFA.
