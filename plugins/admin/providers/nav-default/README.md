# @veren/admin-navigation-default

The default `navigation` capability provider for the DSH admin platform. It owns
the menu registry and ships the baseline admin menu; the shell renders whatever
this capability returns for the current principal.

## What it provides

- An implementation of `AdminNavigation` from `@veren/admin-contract`, registered
  behind the `ctx.adminNavigation` façade.
- `register(item)`: adds one `AdminNavContribution` and returns an idempotent
  disposer. A duplicate id throws `AdminError('CONFLICT', ...)`; the registry
  never silently replaces another module's entry.
- `tree(principal)`: filters by permission, orders the result, and projects it
  to `AdminNavNode`.
- `health()`: `ok` while the registry is readable.
- The default contributions listed below, registered by the provider itself.

There are **no HTTP routes**: menus are read in-process by the shell, and every
route keeps its own server-side permission check. Hiding a menu entry is UX, not
authorization.

## Default contributions

| id | path | icon | permission | labelKey | order |
|---|---|---|---|---|---|
| `dashboard` | `/` | `dashboard` | `admin.dashboard.read` | `nav.dashboard` | 10 |
| `users` | `/users` | `users` | `admin.users.manage` | `nav.users` | 20 |
| `roles` | `/roles` | `shield` | `admin.roles.manage` | `nav.roles` | 30 |
| `audit` | `/audit` | `audit` | `admin.audit.read` | `nav.audit` | 40 |
| `capabilities` | `/system/capabilities` | `capabilities` | `admin.capabilities.read` | `nav.capabilities` | 50 |

Orders are spaced by ten so a module can insert entries between them (for
example `order: 25`) without renumbering the defaults.

## Configuration

None. `Config` is an empty schema: default entries are code, and contributions
come from other modules at runtime. Keeping the shape empty means a profile row
cannot silently pass options that are ignored.

## Ordering and filtering

1. Filter: an entry with no `permission` is always visible; otherwise the
   provider asks `ctx.adminAccess.can(principal, permission)`.
2. Group: entries are bucketed by `group` (absent = one unnamed bucket). Buckets
   appear in the order their first member was registered, so a module's entries
   stay contiguous.
3. Sort each bucket by `order ?? 0`, then by `id` for a deterministic tie-break.
4. Project to `AdminNavNode`.

Filtering runs before ordering, so denied entries leave no gaps.

## Known limitations

- **In-memory registry.** Contributions are lost when the plugin unloads and are
  rebuilt by each module at load time. There is no persistence, no per-user
  override and no runtime reordering UI.
- **No badges.** `AdminNavNode.badge` is omitted: badge counts belong to the
  module that owns the data, and this provider has none. A module that owns a
  count must extend navigation (or the shell) to supply it.
- **Id collision fails the plugin.** A duplicate id throws during registration.
  Modules should namespace ids (`module.entry`) to avoid taking down their own
  load.
- **Permission filtering trusts the access provider.** If `access` is absent,
  `tree` throws `CAPABILITY_UNAVAILABLE` rather than showing everything; the
  capability is essential, so the boot gate should have caught that earlier.
- **Default entries are not configurable.** Replace the provider (or disable it)
  if a deployment needs a different baseline; there is no per-entry toggle.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/nav-default
```

The suite covers registration and disposal, default entries, permission
filtering, grouped ordering, duplicate-id conflicts and idempotent disposers.
