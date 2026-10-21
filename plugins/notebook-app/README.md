# @veren/notebook-app

The notebook **application layer** (G2 package split): registers the notebook as a first-class application — a note list entry page plus a note detail page under `/apps/notebook/...`, with app-scoped `notebook__*` page tools that act through the `@veren/notebook` service's public tools port.

## What it registers

- **App** `notebook` (tool prefix `notebook_`), entry page `list`.
- **Pages**
  - `list` — `/apps/notebook/list` (entry): the calling preset's notes, tools `notebook__list_notes` / `notebook__write_note`;
  - `note` — `/apps/notebook/note/:noteId`: one note's title/body/updatedAt, tools `notebook__read_note` / `notebook__rewrite_note` / `notebook__delete_note`.
- **App-scoped tools** — the app-scoped twin of the host's global `notebook_*` tools: same service port, same ownership rule (the owner always comes from the calling preset and is never a parameter), shorter local names.

## Dependencies and failure semantics

This plugin **is** the application layer, so the application framework and the host service are declared hard injects (`apps`, `notebook`, `agentPresets`): where either is absent the plugin stays pending — loudly visible in the plugin page — and never half-activates. The host package `@veren/notebook` works alone without this package; installing this package is what turns the notebook into an app.

Registration is single-entry (`ctx.apps.register` → `ctx.apps.tools(id).define` → `ctx.apps.pages(id).register`) inside one `ctx.effect` that rolls finished steps back in reverse when a later one fails.

## Which packages to install

| You want | Install |
| --- | --- |
| Notebook tools in headless / framework-absent deployments | `@veren/notebook` alone |
| Notebook as an app in the Web GUI + everything above | `@veren/notebook-bundle` (Host + this package + `notebook-ui`, plus the framework via `app-host-bundle`) |

## Development

```sh
pnpm --dir plugins/notebook-app test        # vitest: the framework-present acceptance face
pnpm --dir plugins/notebook-app typecheck   # tsc against the real Harness sources
```
