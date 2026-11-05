# @veren/baidu-pan

Baidu Netdisk operations for DSH — for agents **and** for people. Thirteen model-facing tools (`baidu_pan__*`) browse, search, organize, share, upload and download against the signed-in account, all confined to the app's authorized root by a guard module, with a bundled skill carrying the risk/confirmation discipline and a paste-code OAuth sign-in flow that keeps tokens only in the credential store. A web client panel (the `baiduPan` Remote namespace) gives the human operator the same operations — sign-in, browsing, sharing, transfers — from the sidebar. The package is the DSH port of the design doc in [design/](./design/index.md) — the design's client/guard/bridge/skill modules collapsed into one plugin (command line and binary delivery are replaced by the DSH tool face; the design's chapter 8–13 views live on as the panel).

Use this plugin when a deployment's agents must operate a real Baidu Netdisk account, or when its human operators want a direct panel for the same: list or search files, move content between the machine and the disk, organize directories, mint share links, or check quota. Skip it when the deployment never touches Baidu Netdisk, or when the need is third-party share-link saving (转存) or document text extraction — those live behind web-cookie endpoints outside the official open platform and are **not covered** by this version.

## Tools

- tool: `baidu_pan__whoami` — the signed-in account and VIP tier (read)
- tool: `baidu_pan__quota` — total/used/free bytes and expiry hint (read)
- tool: `baidu_pan__list` — one directory inside the root, with sorting and paging (read)
- tool: `baidu_pan__search` — keyword search over file names, optionally scoped (read)
- tool: `baidu_pan__meta` — metadata for 1–100 fsids, including the download dlink (read)
- tool: `baidu_pan__mkdir` — create a directory, multi-level (write)
- tool: `baidu_pan__copy` — copy into a destination directory, conflicts fail (write)
- tool: `baidu_pan__move` — move into a destination directory, conflicts fail (write)
- tool: `baidu_pan__rename` — rename in place, bare names only (write)
- tool: `baidu_pan__delete` — irreversible delete, gated by an exact-match `confirm_paths` voucher (dangerous)
- tool: `baidu_pan__share` — private share link with password and period (write)
- tool: `baidu_pan__upload` — local file → root, 4 MiB slices, fast-upload aware, overwrite needs prior user consent (write)
- tool: `baidu_pan__download` — root file → local workspace or absolute path, partials cleaned on failure (write-local)

Skill: `baidu-pan` — the bundled behavior discipline: trigger judgement, the read/write/destructive risk tiers, confirmation ordering, display-path and link pass-through rules, and code-driven failure handling.

## Web panel

The plugin mounts the `baiduPan` Remote namespace (service `baiduPanGateway`, registered by the same apply) and a client entry (`./client`) that registers a sidebar panel. Three tabs:

- **Overview** — the sign-in state (account, expiry, membership), the quota card, and the paste-code sign-in wizard: anonymous users open the authorize link, paste the code back, and the exchange/validate/commit chain runs inside the panel — no agent needed.
- **Files** — breadcrumb browsing inside the authorized root with client-side sort/filter, keyword search with paging, and per-row actions: open, share (period picker, link + password card), download, rename, copy/move, copy path, and delete behind an exact-set confirm dialog. Upload takes an absolute local path; a same-named conflict offers an explicit overwrite.
- **Transfers** — upload/download jobs presented as accepted-then-polled cards (`running` first), plus a standalone download form. A job only ever promises "submitted"; completion is read from its state.

Panel reads and writes ride the same guard as the tools: out-of-root paths are refused locally, deletion demands the exact-path voucher, and domain failures carry stable `BDPAN_*` codes into the panel's error blocks. The design's four states (loading / empty / failure / no-permission) are covered per view.

## Install and sign in

1. Create an app on the [Baidu Netdisk open platform](https://pan.baidu.com/union/doc) console to obtain `appKey`/`secretKey`.
2. Mount the plugin on a profile:

   ```bash
   dsh web --patch plugins/baidu/cordis.patch.yml
   ```

   The patch row carries `appKey`/`secretKey` and the authorized `root` (default `/apps/bdpan`). `appKey`/`secretKey` are app-level credentials and sit in the profile config in plaintext; the OAuth user tokens are a different tier and live only in the credential store.
3. Sign in either through the host's authorization entry (the flow opens the Baidu authorize page — oob shape, no callback server — you paste the code back, tokens are exchanged, validated against the profile endpoint, and only then committed; a second method accepts an existing `access_token refresh_token` pair) **or** directly in the web panel's Overview tab with the same paste-code chain.
4. Until signed in, every tool answers `BDPAN_AUTH_REQUIRED`, and the panel shows the sign-in guide.

## Security model

- Paths are normalized locally before anything goes out: traversal (`..`, encoded forms, `~`, platform traps) and out-of-root paths are refused without a request (`BDPAN_PATH_OUT_OF_SCOPE`).
- Deletion requires a voucher whose normalized path set equals the target set exactly — any mismatch bounces with `BDPAN_CONFIRM_REQUIRED`; confirmations never carry over.
- Tokens refresh automatically before expiry and replay once on stale-token errnos; a failing refresh demands re-authorization, never a silent downgrade.
- Logs and diagnostics are redacted; tokens never enter config files, logs, or command lines.
- The upload's create step never blind-retries: a network failure there folds into `BDPAN_OUTPUT_UNCERTAIN` so the caller verifies the remote state first.

## Boundary of this version

- Third-party share-link transfer (转存) is not implemented — the open platform does not expose it; the upstream codes the design documents for it are web-cookie territory.
- Document text extraction/reading (`get-content`, SVIP-gated docparse) is not implemented.
- Design modules `memory` (backup/restore) and `delivery` (installer) are out of scope: DSH replaces the CLI delivery, and memory backup remains a future module per the design's own review.

## Development

```bash
pnpm install
pnpm --dir plugins/baidu run typecheck   # tsc ×2 (Node half + client half)
pnpm --dir plugins/baidu test            # vitest unit suite (76 tests)
pnpm --dir plugins/baidu run build       # dist/ + lib/client.js
```

The design contract lives in [design/index.md](./design/index.md); `src/` mirrors its module boundaries (`guard`, `client`, tool face, `skill`, web `gateway`), `tests/guard.spec.ts` executes the design's GD acceptance rows, `tests/remote-arity.spec.ts` pins the client↔gateway wire contract, and `tests/panel-dialect.spec.ts` audits the panel stylesheet against the design's token discipline.
