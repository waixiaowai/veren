# @veren/baidu-pan-ui

The Baidu Netdisk **web panel** for DSH: a sidebar entry plus three tabs that give a human operator the same reach the `@veren/baidu-pan` tools give an agent.

Use this package when a DSH web deployment already runs `@veren/baidu-pan` and its people want a graphical entry — sign in, browse, share, transfer. Skip it when the deployment is headless, or when the tools alone are enough.

## The three tabs

- **Overview** — the sign-in state (account, expiry, membership), the quota card, and the paste-code sign-in wizard: anonymous users open the authorize link, paste the code back, and the exchange → validate → commit chain runs inside the panel — no agent needed.
- **Files** — breadcrumb browsing inside the authorized root with client-side sort/filter, keyword search with paging, and per-row actions: open, share (period picker, link + password card), download, rename, copy/move, copy path, and delete behind an exact-set confirm dialog. Upload takes an absolute local path; a same-named conflict offers an explicit overwrite.
- **Transfers** — upload/download jobs as accepted-then-polled cards (`running` first), plus a standalone download form. A job only ever promises "submitted"; completion is read from its state.

Panel reads and writes ride the same guard as the tools: out-of-root paths are refused locally, deletion demands the exact-path voucher, and domain failures carry stable `BDPAN_*` codes into the panel's error blocks. Every view covers the design's four states (loading / empty / failure / no-permission).

## Shape

This is a **pure client package**, the same shape as `@veren/im-ui` and `@veren/mail-ui`:

- `./` (`dist/index.js`) is an empty `apply` — it exists only so the Web application, which scans the manifests of *active Loader entries*, can see this package's `dsh.client` declaration.
- `./client` (`lib/client.js`) is the browser bundle: it mounts the host's `baiduPan` Remote namespace, registers the sidebar entry and the main panel, installs the locale dictionary, and installs its stylesheet.

The bundle's only external `require`s are `react`, `react/jsx-runtime`, and `zod` — the shell seeds exactly those. Pulling in another client package at runtime fails the module's materialization, which silently drops the whole panel.

The panel's design contract lives in [`../design/`](../design/index.md): chapter 9 (tokens, spacing, motion, copy), chapters 10–11 (basic and composite components), chapters 12–13 (business components and pages).

## Install

Install it through its bundle, which also inserts the server row:

```bash
dsh plugin --profile web add @veren/baidu-pan-bundle
```

## Development

```bash
pnpm --dir plugins/baidu/ui run typecheck   # tsc ×2 (Node half + client half)
pnpm --dir plugins/baidu/ui test            # vitest: locale table, stylesheet dialect, wire arity
pnpm --dir plugins/baidu/ui run build       # dist/index.js + lib/client.js
```

`tests/remote-arity.spec.ts` pins the client↔gateway wire contract (method names, namespace, service key, arity), `tests/client-locales.spec.ts` audits the bilingual dictionary, and `tests/panel-dialect.spec.ts` enforces the stylesheet's token discipline.
