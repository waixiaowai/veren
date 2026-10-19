# `@veren/admin-ui-contract`

Use when a browser-side admin plugin needs the stable UI contract: it declares the
pack manifest, the per-audience manifest, the theme/locale/icon/shell/page
contribution types and the runtime object a pack receives, so packs and the SPA
can evolve independently; skip it when you only need Host capability types.

## Packs

A pack is a same-origin ESM entry exporting one `activate(runtime)` function. It
carries data, never code that reaches the network or the DOM directly.

| Kind | Contributes | Public before sign-in |
|---|---|---|
| `shell` | Shell identity and label | yes |
| `theme` | CSS custom properties for light and dark | yes |
| `locale` | Message dictionary | yes |
| `icons` | Name → inline SVG | yes |
| `page` | SPA route, title key, permission, icon | no |

`UiPackManifest` carries `id`, `version`, `uiContract`, `kind`, same-origin
`entry`, bilingual `label`, optional `description` and `order`.

## Runtime

`AdminUiRuntime` exposes `contract` plus `registerTheme`, `registerLocale`,
`registerIcons`, `registerShell` and `registerPage`. A pack registers data; the
SPA owns rendering, routing, persistence and accessibility.

## Theme tokens

A theme must define `--admin-bg`, `--admin-surface`, `--admin-surface-2`,
`--admin-border`, `--admin-text`, `--admin-muted`, `--admin-accent`,
`--admin-accent-text`, `--admin-danger`, `--admin-radius` and `--admin-shadow` in
both schemes. A missing token silently falls back to a stylesheet default, which
breaks the promise that swapping a theme changes values only.

## Contract version

`UI_CONTRACT_VERSION = '1.0.0'`. Packs declare a range (`^1.0`) that the UI kernel
negotiates before publishing them.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/ui-contract
```
