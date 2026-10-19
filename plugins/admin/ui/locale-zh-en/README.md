# @veren/admin-locale-zh-en

## What it replaces

The message layer of the admin SPA. Every visible string — menu labels, table
headers, buttons, empty and error states, toasts — is resolved through a locale
dictionary, so a deployment can reword the entire surface without touching the
SPA. Menu labels arrive from the Host as keys (`bootstrap.nav[].labelKey`), so
the same dictionary serves navigation and pages.

## What it defines

Two locales, `zh` and `en`, with exactly the same key set:

| Namespace | Covers |
|---|---|
| `app.*` | Title, loading/empty/error states, retry/cancel/save/delete/close, 404 and 403 copy |
| `nav.*` | Sidebar labels resolved from the navigation capability |
| `auth.*` | Sign-in and first-run setup copy, including `auth.invalid` |
| `dashboard.*`, `users.*`, `roles.*`, `audit.*`, `capabilities.*` | Page titles, table headers, actions |
| `common.*` | Yes / no |
| `health.*` | Health badges: healthy, degraded, down |
| `theme.toggle`, `locale.toggle` | Top-bar switch labels |
| `toast.*` | Short success confirmations |

## Missing keys

The SPA falls back to the key itself, never to another language. A pack that
ships only `users.*` therefore shows `nav.roles` where a label is missing —
visible, greppable and fixed in one file.

## How to swap it

Locales accumulate: the runtime registers every locale every pack publishes, so
a second pack adds `ja` or `de` without disabling this one. To replace the
wording of `zh`/`en` instead, disable the default row and enable your pack; the
SPA keeps whichever locale id is stored and falls back to the first registered
locale when it disappears.

```yaml
- id: admin-locale-zh-en
  disabled: true
- id: my-copy
  name: '@acme/admin-locale-brand'
```

A replacement is a dependency-free browser ESM package whose `client.js` exports
`activate(runtime)` and calls `runtime.registerLocale({ id, label, messages })`.

## What it does not do

- No date or number formatting tables: the SPA uses `Intl` with the locale id.
- No plural rules or interpolation: the keys above are complete sentences.
- No `localStorage`: the SPA owns the active locale choice.
