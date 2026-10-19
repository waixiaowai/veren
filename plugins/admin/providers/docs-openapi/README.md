# @veren/admin-docs-openapi

The default `docs` capability provider for the DSH admin platform. It publishes
generated documentation — never a hand-written spec — from the kernel capability
catalog and the API gateway's live route table.

## What it provides

- An implementation of `AdminDocs` from `@veren/admin-contract`, registered
  behind the `ctx.adminDocs` façade:
  - `catalog()` refreshes capability and backend health, then returns
    `ctx.admin.catalog()`.
  - `openapi()` returns `ctx.adminApi.openapi()`.
  - `health()` probes the gateway.
- Four routes:

| Method | Path | Permission | Tags |
|---|---|---|---|
| `GET` | `/api/admin/v1/capabilities` | `admin.capabilities.read` | `capabilities` |
| `GET` | `/api/admin/v1/health/backends` | `admin.capabilities.read` | `health` |
| `GET` | `/api/public/v1/openapi.json` | public, no permission | `docs` |
| `GET` | `/api/admin/v1/docs` | `admin.capabilities.read` | `docs` |

Registered route paths are audience-relative (`/capabilities`,
`/health/backends`, `/openapi.json`, `/docs`); the table shows the public paths
the gateway derives.

Payloads:

- `/capabilities`: the full `CapabilityCatalog` (`contractVersion`,
  `capabilities[]` with active provider and health, `features`).
- `/health/backends`: `{ backends: [{ name, health }] }` from
  `refreshHealth()`.
- `/openapi.json`: an OpenAPI 3.1 document generated from every registered
  route.
- `/docs`: the documentation index:

```json
{
  "openapi": "/api/public/v1/openapi.json",
  "capabilities": "/api/admin/v1/capabilities",
  "uiManifest": "/api/admin/v1/ui-manifest"
}
```

## OpenAPI path deviation

The design document names `/api/openapi.json` as the OpenAPI location. The
gateway routes strictly by audience prefix (`/api/admin/v1/...`,
`/api/public/v1/...`, `/api/terminal/v1/...`) and cannot express a path outside
that scheme, so this provider serves the document at
**`/api/public/v1/openapi.json`** and advertises that path from `/docs`. The
document at that URL is public on purpose: it is generated before login and
contains only declared paths, permissions and tags — no deployment secrets.

## Configuration

None. `Config` is an empty schema: the published paths are part of the contract,
so making them configurable would make generated clients depend on a profile
row.

## Known limitations

- **UI manifest is owned elsewhere.** `/docs` advertises
  `/api/admin/v1/ui-manifest`, but this provider does not serve it; the UI
  kernel does. A deployment without that package returns 404 for the advertised
  path.
- **No caching.** Every `/capabilities` request probes every capability and the
  data backend; the OpenAPI document is regenerated per request. That is
  deliberate — generated docs can never disagree with the live route table —
  but it makes these endpoints unsuitable for high-frequency polling.
- **OpenAPI depth.** The gateway generates paths, methods, summaries, tags,
  security schemes and `x-admin-*` metadata. It does not yet emit request body
  or query parameter schemas, so generated clients see the operation shape but
  not field-level details.
- **The openapi route documents itself.** Adding routes changes the document,
  including the docs routes; clients should fetch it at runtime rather than
  pinning a snapshot.
- **Permission names are wire values.** `x-admin-permission` is emitted from the
  route declaration, so renaming a permission is a breaking change for generated
  clients just like for the gateway.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/docs-openapi
```

The suite covers registration and disposal, route metadata, catalog and backend
health payloads, the generated OpenAPI document and the docs index.
