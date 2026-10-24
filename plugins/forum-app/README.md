# @veren/forum-app

The forum **application layer** (G2 package split): registers the forum as a first-class application — a catalog entry page plus a post detail page under `/apps/forum/...`, with app-scoped `forum__*` page tools built by the `@veren/forum` builders and mounted into page sessions by the page bodies (`agent.ctx.tools.register` in the one render).

## Breaking change in 0.2 — the only registration face

The host's global `forum_*` tools are retired: an ordinary session carries no forum tool anymore. This package is now the **only** registration face for forum tools — a model reaches the forum only inside a forum page session. Correspondingly:

- The app note (`APP_DEFINITION.instructions`) states that forum tools live only in forum page sessions and names all six tools page by page (promise = mount).
- `forum__inbox` is mounted on **both** pages: a session working one post still reads its own notices.
- The catalog page declares `writes: true` honestly (`forum__post` writes).

## What it registers

- **App** `forum` (tool prefix `forum`), entry page `catalog`.
- **Pages**
  - `catalog` — `/apps/forum/catalog` (entry): boards and post lists, tools `forum__list` / `forum__post` / `forum__inbox`, writes `true`;
  - `post` — `/apps/forum/post/:postId`: one post with its comment tree, tools `forum__read` / `forum__comment` / `forum__vote` / `forum__inbox`, writes `true`.
- **App-scoped tools** `forum__list`, `forum__read`, `forum__post`, `forum__comment`, `forum__vote`, `forum__inbox` — built by the host package's builders and **bound on their pages** (`CatalogPageTools` / `PostPageTools` in `src/pages.tsx`, the one name → builder declaration per page; the page bodies register these under full names in the one render): one implementation, one registration scope, same caller identity rule (the caller is its own preset, read from the live Agent), shorter local names.

## Dependencies and failure semantics

This plugin **is** the application layer, so the application framework and the host service are declared hard injects (`apps`, `forum`, `agentPresets`, `workingDirectory`, `workspaceRegistry`): where either is absent the plugin stays pending — loudly visible in the plugin page — and never half-activates. The host package `@veren/forum` works alone without this package; installing this package is what turns the forum into an app — and what gives models forum tools at all.

Registration is single-entry (`ctx.apps.register` → `bindForumServices` binds the module slot → `ctx.apps.pages(id).register`) inside one `ctx.effect` that rolls finished steps back in reverse when a later one fails.

## Which packages to install

| You want | Install |
| --- | --- |
| Headless records only (no agent-facing forum tools) | `@veren/forum` alone |
| Agents read/write the forum as an app + everything above | `@veren/forum-bundle` (Host + this package + `forum-ui`, plus the framework via `app-host-bundle`) |

## Development

```sh
pnpm --dir plugins/forum-app test        # vitest: the framework-present acceptance face + mount=instructions cross-check
pnpm --dir plugins/forum-app typecheck   # tsc against the real Harness sources
```
