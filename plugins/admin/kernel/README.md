# `@veren/admin-kernel`

Use when a DSH admin deployment must pick exactly one implementation per
capability and let consumers depend on a stable façade: it registers providers
from their manifests, negotiates the contract range, refuses incompatible or
conflicting providers, derives the capability catalog and health, and enforces
the essential-capability boot gate; skip it when you only need the contract
types.

## What it provides

- `ctx.admin` — the kernel: `register`, `require`, `has`, `catalog`, `features`,
  `refreshHealth`, `ready`.
- Stable façades: `ctx.adminData`, `ctx.adminAuth`, `ctx.adminAccess`,
  `ctx.adminNavigation`, `ctx.adminAudit`, `ctx.adminSettings`, `ctx.adminDocs`.
- `ctx.adminReadiness` — published once every essential capability has an active
  provider. Consumers list it in `inject` to be ordered after the provider rows;
  the name is exported as `ADMIN_READINESS_SERVICE`.

A façade is a `Proxy` that resolves the active provider on **every access**, so
an in-flight request and a live UI subscription survive a provider swap. Symbols
and `then` are not forwarded (the façade must not look thenable).

## Selection and conflicts

| Situation | Result |
|---|---|
| Range excludes `1.0.0` | `CONTRACT_INCOMPATIBLE` at registration |
| Duplicate provider id | `PROVIDER_CONFLICT` |
| Duplicate priority in one capability | `PROVIDER_CONFLICT` |
| Several compatible providers | Highest `priority` wins; ties resolve to the most recent |
| No provider when a façade is called | `CAPABILITY_UNAVAILABLE` with the registered ids |

Replacing a provider therefore means registering an implementation with a
**different** priority and disposing the old registration; consumers keep the
same façade object.

## Catalog, health and the boot gate

`catalog()` returns `{ contractVersion, capabilities, features }` using the last
probed health; `refreshHealth()` probes every capability's optional `health()`
hook and the `data` backend, then updates that cache. `features` is one boolean
per capability, derived from the catalog (never stored separately).

`ready()` throws `ESSENTIAL_CAPABILITY_MISSING` listing every missing capability
among `data`, `auth`, `access`, `navigation`, `audit` plus anything listed in
config.

`register()` publishes `adminReadiness` the moment the last essential provider
registers. `@veren/admin-web` injects that service, so Cordis holds the web row
pending until the provider rows have run — even when the loader mounts rows
concurrently, and regardless of patch row order. The service is a one-way boot
latch: it is not withdrawn when a provider is later removed, so `ready()` stays
the live gate (and `@veren/admin-web` still calls it in `apply`).

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `essential` | `[]` | Extra capability names this deployment treats as essential. An unknown name fails the load. |

## Known limitations

- Replacement is live (priority + disposers) but **not transactional**: there is
  no drain/in-flight barrier and no automatic rollback.
- Health is pull-based; nothing polls in the background.
- Data-engine features are reported by the `data` provider and not enforced by
  the kernel.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/kernel
```
