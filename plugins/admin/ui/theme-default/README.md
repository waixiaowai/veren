# @veren/admin-theme-default

## What it replaces

The theme layer of the admin SPA: the CSS custom properties every page and
component consumes. It is one of four replaceable UI packs (theme, locale,
icons, shell). Pages never name a colour; they only read `var(--admin-*)`, so a
different pack changes the look without touching a view.

## Tokens it defines

Both schemes define the same eleven tokens:

| Token | Meaning |
|---|---|
| `--admin-bg` | Page background behind the shell |
| `--admin-surface` | Cards, top bar, dialogs |
| `--admin-surface-2` | Table headers, hover rows, inputs |
| `--admin-border` | Hairlines and control outlines |
| `--admin-text` | Primary text |
| `--admin-muted` | Secondary text and metadata |
| `--admin-accent` | Primary action background |
| `--admin-accent-text` | Text on the accent |
| `--admin-danger` | Destructive actions and errors |
| `--admin-radius` | Corner radius shared by every surface |
| `--admin-shadow` | Elevation used by dialogs and popovers |

Contrast: text and muted text stay at or above 4.5:1 against both `--admin-bg`
and `--admin-surface` in both schemes; accent and accent-text are likewise at
least 4.5:1.

## How to swap it

The SPA uses the first registered theme. Disable the default row and enable
another pack that registers its own theme id:

```yaml
- id: admin-theme-default
  disabled: true
- id: my-brand-theme
  name: '@acme/admin-theme-brand'
```

The replacement must be a dependency-free browser ESM package whose
`client.js` exports `activate(runtime)` and calls `runtime.registerTheme(...)`
with the same eleven tokens. A pack that fails to load is skipped with a console
warning; the SPA keeps rendering with the stylesheet defaults.

## What it does not do

- No external fonts, images or remote URLs; tokens are plain values.
- No layout decisions: spacing and grid live in the SPA stylesheet.
- No `localStorage` or preference handling: the SPA owns light/dark/system.
