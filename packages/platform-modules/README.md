# @veren/platform-modules

The Web shell's frozen module table, as build-time data for Veren browser plugins.

## When to use it

Use this package when a Web-shell plugin build (a `tsdown.config.ts` or an esbuild
bundling script) needs the list of module specifiers that the shell shares through
`window.__ModuleLoader__`. The plugin marks those specifiers external; the shell
injects one shared instance of each. Do not use it at runtime, and do not copy the
list into a plugin.

## What it is

- Zero build: `exports` points directly at `platform-modules.mjs` and
  `platform-modules.d.mts`; there is no `build` script and no compiled output.
- `PLATFORM_MODULES` is the single copy of the table. The declaration is a literal
  tuple, so a misspelled specifier fails type checking instead of being silently
  treated as a bundled module.
- Build-time only: add it to a plugin's `devDependencies`, never to
  `dependencies` or to the plugin's `files`.

```json
{
  "devDependencies": {
    "@veren/platform-modules": "workspace:*"
  }
}
```

```ts
import { PLATFORM_MODULES } from '@veren/platform-modules'

const external = [...PLATFORM_MODULES]
```

## Drift gate

`pnpm check:platform-modules` runs [`scripts/check-platform-modules.mjs`](../../scripts/check-platform-modules.mjs).
It reads `PLATFORM_MODULES` from the DSH checkout's
`packages/client/web/src/platform.ts` (default `deepseek/deepseek-harness`,
overridable with `DSH_CHECKOUT`) and fails when this package has a missing,
extra, duplicated, or reordered module. It also checks that the runtime array and
the declaration tuple agree.

The table is a contract: changing it changes what the shell injects, so the same
change must move every UI plugin's `engines.dsh` range.
