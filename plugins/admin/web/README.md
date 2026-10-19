# `@veren/admin-web`

Use when an admin deployment must serve its browser SPA: it mounts the same-origin
shell with a strict content security policy, serves static assets and registered
UI pack files without escaping their roots, publishes the bootstrap payload
joining identity, permissions, navigation and feature flags, and enforces the
essential-capability boot gate; skip it when the deployment is API-only.

## Served URLs

| Path | Response |
|---|---|
| `/` | 302 → `<mountPath>/` |
| `/admin` and `/admin/` | SPA shell (`client/index.html`) |
| `/admin/<any dotless path>` | SPA shell (History API deep link) |
| `/admin/assets/*` | Static files from the package `client/` directory |
| `/admin/ui-plugins/<pack>/<file>` | Pack asset resolved by `admin-ui-kernel` |
| `/api/**` | Handled by `@veren/admin-api-kernel`, not this package |

## API routes it adds

| Route | Payload |
|---|---|
| `GET /api/admin/v1/bootstrap` | `{ user, permissions, nav, features, contractVersion, csrfToken }` |
| `GET /api/public/v1/ui-manifest` | Core packs available before sign-in |
| `GET /api/admin/v1/ui-manifest` | Every pack available after sign-in |

`bootstrap` is the only place that joins identity, permissions, navigation and
feature flags, so the SPA renders its first screen from one response. The two
manifests degrade to `{ uiContract: '1.0.0', packs: [] }` when no UI kernel is
mounted.

## Security

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src
  'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri
  'none'; frame-ancestors 'none'`, plus `Referrer-Policy: no-referrer` and
  `X-Frame-Options: DENY`, attached to the shell document.
- Static paths are resolved inside one root and refused when they escape; only
  allowlisted extensions are served.
- Every response is `no-store`; nothing here is meant for a shared cache.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `mountPath` | `/admin` | Where the SPA and its assets mount |

## Boot gate

`apply` calls `ctx.admin.ready()` before registering anything, so a profile
missing `data`, `auth`, `access`, `navigation` or `audit` fails to start instead
of serving a broken shell. This is why the web row must be last in the bundle
patch.

## Known limitations

- The SPA files live in `plugins/admin/web/client/`. When that directory is
  absent (a source checkout before the browser build is present), `/admin`
  answers 404 and only the API routes work.
- Only dotless paths fall back to the shell; a path containing `.` answers 404 so
  a mistyped asset never renders HTML.
- `mountPath` is not validated for shape; a value with a trailing slash is
  normalized, a nested path is not supported.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/web
```
