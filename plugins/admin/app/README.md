# Admin platform bundle — installation and composition.
# 后台平台组合包 — 安装与组合。

## What it is

`@veren/admin-app` is a configuration-only bundle. Its `cordis.patch.yml` inserts
the whole P0 stack into a profile in dependency order:

```text
admin-kernel → admin-api-kernel → admin-data-postgres → admin-access-rbac
→ admin-auth-local → admin-navigation-default → admin-audit-default
→ admin-docs-openapi → admin-ui-kernel → default packs → admin-web
```

Members are plain dependencies of this bundle, so installing the bundle installs
the stack and this patch stays the profile's only admin layer. The row order
stays a dependency order for readability; activation order is enforced by
injection instead, because `admin-web` waits for the kernel's `adminReadiness`
service that `admin-kernel` publishes after the last essential provider.

## Data backend

PostgreSQL is the recommended default. The bundle ships the
`admin-data-postgres` row enabled and the `admin-data-dsh-kv` row disabled.
Configure the connection in the profile (or on the row):

```yaml
- id: admin-data-postgres
  name: '@veren/admin-data-postgres'
  config:
    host: 127.0.0.1
    port: 5432
    user: veren
    password: !!js process.env.VEREN_PG_PASSWORD ?? ''
    database: veren_admin
    schema: public
    migrateOnBoot: true
```

The database and login must exist before the first boot; the schema bootstrap is
idempotent. If the profile serves `storage` and `storageDomain`, the embedded
JSON backend remains available by disabling the PostgreSQL row and enabling the
KV row:

```yaml
- id: admin-data-postgres
  disabled: true
- id: admin-data-dsh-kv
  disabled: false
  config:
    storage:
      backend: json
```

## Requirements of the profile

- A `webServer` row (the admin surface is HTTP).
- A reachable PostgreSQL database for the default provider. Configure it on the
  `admin-data-postgres` row; the defaults (`127.0.0.1:5432`, user `veren`,
  database `veren_admin`) are development conveniences, not deployed settings.
- Only for the JSON fallback: a `storage` group with at least one registered
  backend, plus `storageDomain`. `admin-data-dsh-kv` defaults to
  `{ backend: 'json', routes: {} }`; set `storage.backend` when the profile names
  its backend differently. A missing backend fails the load loudly, naming the
  backend and the registered names.

Nothing else is required: `auth`, `access`, `navigation`, `audit`, `docs`,
`ui-kernel` and the packs are inserted by this patch.

## Install

```text
dsh plugin --profile admin add @veren/admin-app
dsh --profile admin --host 127.0.0.1 --port 3081 --no-open
```

The `admin` profile is not a built-in template name; `dsh plugin` initializes it
with the default base layer and adds this bundle to `dsh.profile.bundles`.

## Replace a provider or a pack

Disable the default row and enable your implementation. The replacement must
declare a different `priority` for the same capability; the kernel refuses two
providers with equal priority so the active implementation is never ambiguous.

```yaml
- id: admin-theme-default
  disabled: true
- id: my-brand-theme
  name: '@acme/admin-theme-brand'
```

## Not included yet

Tasks, forms, assist, attachments, notifications, jobs and settings are P1
capabilities; their names are in the contract but no provider ships in this
bundle. `admin-web` renders them as hidden because `features` reports them as
absent.
