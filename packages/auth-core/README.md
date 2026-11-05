# @veren/auth-core

Embeddable authentication framework implementing `plugins/auth/design` (the
Better Auth 1.7.16 design, re-specced as this workspace's own framework). Use
it when a host application must own sign-up, sign-in, sessions, password
policy, origin/rate guarding and the identity authority over its own database
— while keeping every security boundary (origin checks, rate limits,
sensitive-session reads, equal-time failures, atomic credential consumption)
inside one assembly rather than scattered through business code. Skip it when
a hosted auth service already answers those calls for the app.

Assembly follows the design's four planes: `context` merges options, secrets,
table models and extension declarations into one shared runtime context;
`endpoint` registers every capability as a routed endpoint guarded by origin
validation, rate limiting and session middlewares; the `identity`,
`credential` and `session` domains own their authorities exclusively; and
`storage` lands reads/writes on a `DBAdapter` — shipped here over
`@veren/orm` (`createOrmAdapter`) with atomic `consumeOne`/`incrementOne`
primitives.

## When to use which entry

- `createAuth({ adapter, options })` — assemble one auth instance. The
  product exposes `handler(request)` (HTTP entry) and `api.<key>(input)`
  (embedded entry); both share the identical hook pipeline.
- `createOrmAdapter(dataSource, tables)` — the `DBAdapter` over a
  `@veren/orm` DataSource. Pass `getAuthTables(...)` models and register
  `createAuthEntities(tables)` on the DataSource before `initialize()`.
- `createAuthEndpoint` / `AuthPlugin` — the extension contract: plugins may
  register endpoints, contribute table models (`schema`), mount request
  hooks, and declare rate-limit rules. They must never write session rows or
  user profiles directly.

## Coverage against the design (plugins/auth/design)

| Design module | Status |
|---|---|
| 01 context | implemented (normalized options, versioned secrets, per-request clones, plugin init merge) |
| 02 endpoint | implemented (route table, middlewares, hook pipeline, path params, disabled paths, server-only) |
| 03 session | implemented (issue, resolve, throttled refresh, freshness, revocation family) |
| 04 credential | implemented (scrypt `salt:key`, length policy, equal-time failure, atomic reset consumption) |
| 05 identity | implemented (user/account/verification authority, transactional registration, binding-first resolution) |
| 07 guard | implemented (origin/redirect validation, cross-site navigation block, rate limiting) |
| 08 storage | implemented (DBAdapter contract, ORM adapter, atomic primitives, table-model merge) |
| 12 diagnostics | implemented (49 base error codes, `APIError`, response shape) |
| 09 plugin | implemented as the extension contract (endpoints/schema/hooks/rateLimit/init patches) |
| 06 oauth / 13 organization / 14 strongauth / 15 enterprise / 11 cli / 10 client / 16 reference | not implemented — peripheral domains, deferred until a host needs them |

Core endpoints delivered: API-02-01/02, API-03-01..07, API-04-01..07,
API-05-01/02/04/05/06/08 (`change-email` answers `CHANGE_EMAIL_DISABLED` by
default; `delete-user` is intentionally absent, answering 404, per the
design's opt-in switch).

## Tests

`pnpm test` — unit/integration suite over in-memory sqlite; each case maps to
an acceptance row of the design's module chapters (§1.5/2.5/3.5/4.5/5.5/7.5/8.5)
and the cross-module contract table (§11.2).

中文文档见 [README.cn.md](./README.cn.md)。
