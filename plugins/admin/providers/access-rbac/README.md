# `@veren/admin-access-rbac`

Use when an admin deployment needs the default role-based authorization provider: it
owns the role catalog and user-to-role bindings, derives permissions for an
authenticated identity, enforces anti-lockout so the last owner cannot be
stripped, and registers the role-binding routes; skip it when authorization comes
from an external directory service.

## Built-in roles

Defined in code (`src/roles.ts`), so an upgrade can widen a role without a
migration and no deployment can delete `owner` by accident.

| Role | Permissions |
|---|---|
| `owner` | every permission in `ADMIN_PERMISSIONS` |
| `admin` | dashboard, users, roles, tokens, audit, capabilities, settings |
| `reviewer` | dashboard, audit, `terminal.tasks.read`, `terminal.tasks.decide` |
| `operator` | dashboard, capabilities |
| `auditor` | dashboard, audit, capabilities |
| `viewer` | dashboard |

Custom roles live in `admin_roles` and are additive; their permissions must come
from the catalog.

## Storage

| Collection | Content |
|---|---|
| `admin_roles` | custom roles (`id`, `label`, `permissions`, `createdAt`) |
| `admin_bindings` | user↔role pairs, id `${userId}:${roleId}` |

`rolesOf(userId)` reads bindings; `permissionsOf(identity)` unions the permissions
of the roles already carried by the identity, so the gateway makes no extra
permission query per role check.

## Routes

All under `/api/admin/v1`:

| Method | Path | Permission |
|---|---|---|
| `GET` | `/roles` | `admin.roles.manage` |
| `GET` | `/permissions` | `admin.capabilities.read` |
| `POST` | `/roles` | `admin.roles.manage` (audited) |
| `DELETE` | `/roles/:id` | `admin.roles.manage` (audited) |
| `POST` | `/users/:id/roles` | `admin.roles.manage` (audited) |
| `DELETE` | `/users/:id/roles/:roleId` | `admin.roles.manage` (audited) |

## Anti-lockout

`revokeRole(userId, 'owner')` throws `LAST_OWNER` when that user is the only
owner; built-in roles cannot be deleted (`CONFLICT`), and an unknown role id is
`NOT_FOUND`.

## Known limitations

- Deleting a custom role scans every binding to remove it; that is fine for an
  embedded deployment and needs an indexed query on a SQL engine.
- Bindings are not foreign-keyed to users; `auth` removes a user's bindings on
  delete, but a hand-edited database can leave orphans.
- No per-object data scoping: `AdminIdentity.scope` exists but RBAC does not
  enforce row filters.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/access-rbac
```
