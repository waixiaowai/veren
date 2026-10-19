# @veren/admin-icons-default

## What it replaces

The icon layer of the admin SPA. Menus arrive from the Host carrying icon names
(`nav[].icon`), and views ask the runtime for that name — they never import an
icon module or draw an SVG themselves. Swapping this pack therefore changes
every glyph without touching navigation policy or pages.

## What it defines

One icon set (`default`) with these names:

| Name | Used by |
|---|---|
| `dashboard` | Dashboard nav entry and page |
| `users` | Users nav entry and page |
| `shield` | Roles nav entry, brand mark |
| `audit` | Audit nav entry and page |
| `capabilities` | Capabilities nav entry and page |
| `logout` | Sign-out button |
| `sun`, `moon` | Theme switch (light / dark) |
| `globe` | Locale switch |
| `plus` | Create actions |
| `trash` | Delete actions |
| `edit` | Edit actions |
| `menu` | Mobile sidebar toggle |
| `close` | Dialog close |
| `check` | Confirmation affordance |

Every value is a self-contained 24×24 `<svg>` string with
`fill="none" stroke="currentColor"`, a 1.75 stroke width, round joins and
`aria-hidden="true"`. Because colour comes from `currentColor`, one icon serves
both schemes and every accent.

## How to swap it

Icon sets accumulate like locales; the SPA merges them with later packs winning,
so a brand pack may override only `shield` and inherit the rest. To replace the
whole set, disable this row and enable another pack:

```yaml
- id: admin-icons-default
  disabled: true
- id: my-brand-icons
  name: '@acme/admin-icons-brand'
```

A replacement is a dependency-free browser ESM package whose `client.js` exports
`activate(runtime)` and calls `runtime.registerIcons({ id, label, icons })`.

## Safety note

These strings are the only markup the SPA writes with `innerHTML`. An icon pack
is executable same-origin code, so it is trusted exactly as much as the SPA
itself; never build icon markup from user or API data.

## What it does not do

- No remote SVG, icon fonts or sprites: every glyph is inline.
- No colour or size props: size comes from CSS (`1em` by default).
- No semantic labels: the surrounding control must carry the accessible name.
