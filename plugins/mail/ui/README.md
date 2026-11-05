# @veren/mail-ui

The web panel for the notification stack: a sidebar entry that opens one page
with two tabs.

Mounts beside `@veren/mail` and reads its `mail` Remote namespace — it owns no
domain logic and no storage.

## The page

- **Inbox** — the station inbox, newest first: each message with its subject,
  content, and visible state, and one-click mark read / unread / archive /
  unarchive.
- **Activity** — one row per execution chain: the workflow, the outcome, and
  each step's state with the reason a step was skipped.

The catalog re-reads every 5 seconds while the page is open and stops when it
closes. The stylesheet consumes only the shell's `--dsw-*` tokens, so the
panel follows every theme; both baseline locales ship, and a missing
translation is a compile error rather than a missing string at runtime.

## Install

Mounts as part of `@veren/mail-bundle`, after the core (it injects the mounted
`remote.mail` namespace). No config.

## Development

```bash
pnpm --dir plugins/mail/ui typecheck   # against the real Harness sources
pnpm --dir plugins/mail/ui test
pnpm --dir plugins/mail/ui build       # esbuild -> dist/index.js + lib/client.js
```
