# @veren/sub2api-admin

Application-form DSH plugin: registers the "Sub2API 运营" app — nine GUI pages (home / channels / groups / users / subscriptions / finance / codes / accounts / usage) plus eleven model-facing admin tools, sharing one `Sub2AdminClient` and one credential config. The structure mirrors the `@veren/task-workbench` reference: `ctx.apps.register` → tools prepared under full names and bound into the pages' module slot (`bindSub2ApiRuntime`) → `apps.pages`. Tool registration and first-screen reads live in the page bodies (`PageFC`, one-shot render) over a shared in-memory store.

## Pages

| Page | URL | Content | Mounted tools |
| --- | --- | --- | --- |
| home (entry) | `/apps/sub2api-admin/home` | Ops console: revenue/cost/margin/active/new/today requests + tokens, pending orders, error/ratelimit/overload accounts, to-do routing + AI playbook | `overview` |
| channels | `/apps/sub2api-admin/channels` | Upstream channel list; open / edit / take down | `channels`, `request` (channel monitors) |
| groups | `/apps/sub2api-admin/groups` | Group list (rate multiplier / platform / subscription type / limits); create / edit / delete, bulk model rate multipliers | `groups` |
| users | `/apps/sub2api-admin/users` | User list (balance / groups / status); onboard, top-up / deduct, ban, move group | `users` |
| subscriptions | `/apps/sub2api-admin/subscriptions` | Subscription list; assign / extend / reset quota / revoke / restore | `subscriptions` |
| finance | `/apps/sub2api-admin/finance` | Payment orders (first 20) + subscription plans + revenue summary | `payment`, `overview` |
| codes | `/apps/sub2api-admin/codes` | Redeem codes (generate / redeem / expire / delete) + promo codes (create / edit / delete / usages) + redeem stats | `redeem_codes`, `promo_codes` |
| accounts | `/apps/sub2api-admin/accounts` | Upstream account list (platform / type / status / schedulable); status / scheduling / clear-error / quota / bulk ops | `accounts` |
| usage | `/apps/sub2api-admin/usage` | 7-day trend, per-model stats, range aggregates | `usage` |

Live data is pulled once on activation; successful tool writes refresh the matching store slice and the trees sync into page sessions via SNAPSHOT/PATCH. Every page's `instructions` name exactly the tools mounted on it (promise = mount), and a listPage body's 配套工具 line lists their external names.

## Tools (local names; external `sub2api_admin__<name>`, registered by the page bodies)

`overview`, `channels`, `groups`, `users`, `subscriptions`, `payment`, `promo_codes`, `redeem_codes`, `accounts` (15 actions), `usage`, `request` (raw `/api/v1/admin/**` passthrough). Action→endpoint mapping is table-driven; see `src/tools.ts`.

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
