# @veren/admin-shell-default

## What it replaces

The chrome identity of the admin SPA. The shell pack answers "which shell is
this deployment using"; the SPA renders its sidebar, top bar and scrollable
content area from the stylesheet, and reads `bootstrap.nav` — never this pack —
for what to put in the menu.

This keeps layout in one place (the SPA) and identity in another (the pack), so
a deployment that renames or re-skins the shell does not fork the SPA.

## What it defines

Exactly one shell contribution:

| Field | Value |
|---|---|
| `id` | `default` |
| `label.en` | `Default shell` |
| `label.zh` | `默认壳` |

There are no tokens, messages or icons: those belong to the theme, locale and
icon packs.

## How to swap it

The SPA uses the first registered shell. Disable this row and enable another
pack:

```yaml
- id: admin-shell-default
  disabled: true
- id: my-shell
  name: '@acme/admin-shell-brand'
```

A replacement is a dependency-free browser ESM package whose `client.js` exports
`activate(runtime)` and calls `runtime.registerShell({ id, label })`. Because a
pack that fails to load is skipped, the SPA keeps rendering with the built-in
layout even when no shell pack is present.

## What it does not do

- No layout, CSS or markup: the SPA owns all of it.
- No data access: the shell never fetches, it only receives `bootstrap`.
- No authorization: menu visibility is decided by the Host navigation
  capability, and every route is still enforced server-side.
