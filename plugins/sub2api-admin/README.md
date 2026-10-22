# @veren/sub2api-admin

Application-form DSH plugin: registers the "Sub2API 运营" app — three GUI pages (dashboard / accounts / usage) plus six model-facing admin tools, sharing one `Sub2AdminClient` and one credential config. The structure mirrors the `@veren/task-workbench` reference (`ctx.apps.register` → `apps.tools` → `apps.pages`, component pages (`PageFC` + `useSnapshot`) over a shared store).

## Pages

| Page | URL | Content | Data |
| --- | --- | --- | --- |
| dashboard (entry) | `/apps/sub2api-admin/dashboard` | Today requests/tokens/cost/new users, RPM/TPM, user/account/error counts, groups | `GET /admin/dashboard/stats`, `/admin/groups/all` |
| accounts | `/apps/sub2api-admin/accounts` | Upstream account list (first 50): id/name/platform/type/status/schedulable | `GET /admin/accounts` |
| usage | `/apps/sub2api-admin/usage` | 7-day trend, per-model stats, range aggregates | `/admin/usage/stats`, `/admin/dashboard/{trend,models}` |

Live data is pulled once on activation; successful tool writes refresh the matching store slice and the trees sync into page sessions via SNAPSHOT/PATCH.

## Tools (local catalog names; external `sub2api_admin__<name>`)

`overview`, `accounts` (15 actions), `usage`, `users`, `redeem_codes`, `request` (raw `/api/v1/admin/**` passthrough). Action→endpoint mapping is table-driven; see `src/tools.ts`.

## Credentials

Never hardcoded. Resolution order: plugin row `config` → `SUB2API_*` environment variables. Auth precedence: API key > JWT > email+password login (auto re-login on 401).

## Install

Install the companion bundle `@veren/sub2api-admin-bundle` (the stack's single profile layer); see that package's README.

## Development

```powershell
pnpm --dir plugins\sub2api-admin typecheck   # tsc --noEmit (extends the workspace tsconfig.base)
pnpm --dir plugins\sub2api-admin test        # vitest unit tests (mocked fetch)
```

## Known Limitations

- The accounts page fetches the first 50 rows; page through the `accounts` tool for more.
- Streaming file exports (`accounts export`, CSV) are not wrapped; use the `request` tool.
- The trees' GUI rendering rides the host page-session pipeline; this package ships no client UI plugin.
