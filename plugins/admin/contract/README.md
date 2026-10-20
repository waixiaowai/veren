# `@veren/admin-contract`

Use when a package needs the stable Host capability contract of the DSH admin
platform: it declares the capability names, provider manifests, structured
errors, the data port, the unified API route vocabulary, and the
auth/access/navigation/audit/settings/docs interfaces that consumers depend on,
so every consumer can ignore which provider implements them; skip it when you
only need the browser-side UI contract (`@veren/admin-ui-contract`).

The package has **no runtime dependency**: importing it never pulls an
implementation. Consumers depend on this package alone; providers are replaceable
behind the kernel façades.

## Capabilities

| Name | Essential | Default provider in `@veren/admin-app` |
|---|---|---|
| `data` | yes | `@veren/admin-data-postgres` (fallback: `@veren/admin-data-dsh-kv`) |
| `auth` | yes | `@veren/admin-auth-local` |
| `access` | yes | `@veren/admin-access-rbac` |
| `navigation` | yes | `@veren/admin-navigation-default` |
| `audit` | yes | `@veren/admin-audit-default` |
| `settings` | no | not shipped yet (P1) |
| `docs` | no | `@veren/admin-docs-openapi` |

Missing essential capability ⇒ boot fails with `ESSENTIAL_CAPABILITY_MISSING`.
Missing optional capability ⇒ `features` reports `false` and its UI stays hidden.

## Provider declaration

`ProviderManifest` carries `id`, `capability`, `contract` (range),
`priority`, optional `dataDomain`, optional `migrations`, and a display `label`.
The kernel activates the highest priority whose range admits
`ADMIN_CONTRACT_VERSION` (`1.0.0`). A replacement must use a **different**
priority; two equal priorities for one capability are refused.

## Version ranges

`satisfies(version, range)` (in `@veren/admin-kernel`) supports `*`/`x`, exact,
`>= <= > <`, `^` (same major), `~` (same major+minor), whitespace conjunction and
`||` alternatives. A malformed range throws at registration.

## Errors

`AdminError` carries a stable `code`, an optional `details` object, an HTTP
`status`, and a `requestId` filled by the gateway.

| Code | Status | Code | Status |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 | `RATE_LIMITED` | 429 |
| `FORBIDDEN` | 403 | `SETUP_REQUIRED` | 428 |
| `CSRF_FAILED` | 403 | `ALREADY_INITIALIZED` / `LAST_OWNER` | 409 |
| `VALIDATION_FAILED` | 422 | `CAPABILITY_UNAVAILABLE` / `BACKEND_UNAVAILABLE` | 503 |
| `NOT_FOUND` / `METHOD_NOT_ALLOWED` | 404 / 405 | `CONTRACT_INCOMPATIBLE` / `PROVIDER_CONFLICT` | 500 |
| `CONFLICT` | 409 | `ESSENTIAL_CAPABILITY_MISSING` / `INTERNAL` | 500 |
| `PAYLOAD_TOO_LARGE` | 413 | | |

## Protocol constants

`ADMIN_SESSION_COOKIE = 'admin_session'` (HttpOnly), `ADMIN_CSRF_COOKIE =
'admin_csrf'` (readable, double submit), `ADMIN_CSRF_HEADER = 'x-csrf-token'`.
`ADMIN_PERMISSIONS` is the single permission catalog every route, role and
client compares against.

## The data port

`AdminDatabase.table<T>(name)` returns an `AdminTable<T>`: synchronous `find`,
`list` and `size` (the adapter keeps validated state in memory), asynchronous
`save` and `remove`. `transaction(work)` receives an `AdminUnitOfWork` whose
`table()` resolves transaction-bound handles. `features` reports what the engine
can actually do — the DSH KV adapter reports `transactions: false` and
documents that a failed transaction does not roll back.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/contract
```
