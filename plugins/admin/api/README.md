# `@veren/admin-api-kernel`

Use when admin providers and modules must expose HTTP endpoints without
re-implementing security: it registers audience-prefixed routes and applies
request ids, origin and CSRF checks, authentication, permission enforcement, body
limits, rate limiting, validation, auditing, the standard error envelope, and
generated OpenAPI in one fixed order; skip it when the deployment has no HTTP
surface.

## Routes

A provider registers a path relative to its audience and the gateway derives the
public path:

| Audience | Prefix | Authentication |
|---|---|---|
| `admin` | `/api/admin/v1` | `admin_session` cookie + CSRF |
| `terminal` | `/api/terminal/v1` | `Authorization: Bearer` + scopes |
| `public` | `/api/public/v1` | none |

`AdminRoute` carries `method`, `path` (with `:param` segments), `audience`,
`permission?`, `scopes?`, `summary`, `action?`, `tags?`, `input?`, `query?`,
`audit?`, `handler`.

## Pipeline (fixed order)

1. request id (`crypto.randomUUID`)
2. mount-path check → `NOT_FOUND`
3. origin check (`null` refused; same host or `trustedOrigins`)
4. `OPTIONS` preflight → 204
5. route match → `NOT_FOUND` / `METHOD_NOT_ALLOWED`
6. rate limit → `RATE_LIMITED`
7. body limit + JSON parse (unsafe methods) → `PAYLOAD_TOO_LARGE` / `VALIDATION_FAILED`
8. authenticate (session cookie for `admin`, bearer for `terminal`)
9. `AUTH_REQUIRED` for non-public routes without an identity
10. CSRF double submit on unsafe non-public methods → `CSRF_FAILED`
11. resolve permissions, then `permission` → `FORBIDDEN`, then `scopes`
12. validate `query`, then `input` → `VALIDATION_FAILED` (`details.field`)
13. audit intent → handler → audit outcome
14. JSON response (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`)

Errors always render `{ error: { code, message, details?, requestId } }` with the
status mapped from the code.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `mountPath` | `/api` | Prefix the gateway mounts on |
| `maxBodyBytes` | `1048576` | Maximum JSON body |
| `rateLimit.window` | `60` | Fixed window in seconds |
| `rateLimit.max` | `120` | Requests per window per ip+route |
| `trustedOrigins` | `[]` | Extra browser origins allowed to call the API |
| `publicUrl` | `''` | Advertised URL used by generated OpenAPI |

## Behavior notes

- Rate limiting is a fixed window per `ip|audience|method|path`; there is no
  distributed store, so a multi-instance deployment needs an external limiter.
- Audit is **best effort**: a failing audit store never turns a completed write
  into an error, and only routes with `audit: true` produce rows.
- Query keys are collapsed with `Object.fromEntries` (last value wins); the
  handler still reads `request.query` when it needs repeated keys.
- `OPTIONS` is answered globally, before route matching.

## OpenAPI

`adminApi.openapi()` generates OpenAPI 3.1 from the live route table, including
`x-admin-permission` and `x-admin-audience` per operation. A route that is not
registered cannot appear in the document.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/api
```
