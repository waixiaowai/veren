# `@veren/admin-ui-kernel`

Use when an admin deployment must serve replaceable browser packs: it registers UI
packs from their manifests, negotiates the UI contract range, publishes the
pre-login and post-login manifests, and resolves pack assets while refusing paths
outside a pack directory; skip it when the deployment serves no browser UI.

## What it provides

`ctx.adminUi`:

| Method | Result |
|---|---|
| `register({ manifest, root })` | Disposer removing the pack; throws `CONTRACT_INCOMPATIBLE` or `PROVIDER_CONFLICT` |
| `manifest(audience)` | `{ uiContract, packs }`, sorted by kind then `order` |
| `asset(packId, relative)` | `{ path, contentType }` or `undefined` |

## Manifests

Before sign-in the manifest exposes only `shell`, `theme`, `locale` and `icons`.
After sign-in it also exposes `page` packs. `@veren/admin-web` serves the public
manifest at `/api/public/v1/ui-manifest` and the full one at
`/api/admin/v1/ui-manifest`.

## Asset rules

- Only `.js`, `.mjs`, `.css`, `.json`, `.svg`, `.png` and `.webp` are served.
- A resolved path must stay inside the pack's own directory; traversal and
  absolute escapes return `undefined`.
- The request path never selects a pack that was not registered.

## Registration model

P0 packs register themselves through `ctx.adminUi.register()` inside their own
plugin row; the kernel does **not** scan `package.json` `dsh.admin.ui`
declarations. A pack therefore ships a Host entry (`index.js`) plus the browser
`client.js` it points at.

## Known limitations

- A duplicate pack id throws `PROVIDER_CONFLICT`; the JSDoc on the registry still
  says `CONFLICT` and is scheduled to be corrected.
- No integrity hash or signature is verified; the promise is same-origin plus
  manifest control, not supply-chain attestation.
- Assets are read from disk per request with no cache layer.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/ui-kernel
```
