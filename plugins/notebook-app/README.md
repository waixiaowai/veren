# @veren/notebook-app

The notebook **application layer** (G2 package split) and the notebook's
**single registration face**: registers the notebook as a first-class
application — a note list entry page plus a note detail page under
`/apps/notebook/...` — with app-scoped `notebook__*` page tools that act through
the `@veren/notebook` service's public tools port.

## What it registers

- **App** `notebook` (tool prefix `notebook`), entry page `list`.
- **Pages**
  - `list` — `/apps/notebook/list` (entry): the calling preset's notes, tools `notebook__list_notes` / `notebook__write_note`;
  - `note` — `/apps/notebook/note/:noteId`: one note's title/body/updatedAt, tools `notebook__read_note` / `notebook__rewrite_note` / `notebook__delete_note`.
- **App-scoped tools** — the five `@veren/notebook` builders (the one
  model-facing implementation, prepared under full names `notebook__<local>` at
  registration and bound into the pages' module slot via `bindNotebookServices`;
  each page body registers its own tools via `agent.ctx.tools.register` in the
  one render, so they live and die with the agent fiber; nothing registers into
  `ctx.tools`). Same ownership rule as ever: the owner always comes from the
  calling preset and is never a parameter.

## Promise alignment (§3.9)

The catalog face, the per-page mount face, and the instructions' word are one:
every catalog tool is mounted on exactly one page, every mounted tool is named
in that page's instructions, and the instructions never promise a tool the page
does not carry. `tests/app.spec.ts` locks all three directions.

## Dependencies and failure semantics

This plugin **is** the application layer, so the application framework and the host service are declared hard injects (`apps`, `notebook`, `agentPresets`): where either is absent the plugin stays pending — loudly visible in the plugin page — and never half-activates. The host package `@veren/notebook` works alone without this package, but since 0.2.0 it registers no tools; without this package no agent can reach the notebook at all. Installing this package is what turns the notebook into an app.

Registration is single-entry (`ctx.apps.register` → tools prepared under full names and bound into the pages' module slot → `ctx.apps.pages(id).register`) inside one `ctx.effect` that rolls finished steps back in reverse when a later one fails.

## Which packages to install

| You want | Install |
| --- | --- |
| The notebook domain with no model-facing tools (headless / framework-absent deployments) | `@veren/notebook` alone |
| Notebook as an app in the Web GUI, agents reaching it through `/apps/notebook` page sessions | `@veren/notebook-bundle` (Host + this package + `notebook-ui`, plus the framework via `app-host-bundle`) |

## Development

```sh
pnpm --dir plugins/notebook-app test        # vitest: the framework-present acceptance face
pnpm --dir plugins/notebook-app typecheck   # tsc against the real Harness sources
```
