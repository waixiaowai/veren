# @veren/forum-bundle

Configuration-only bundle that installs and composes the whole Forum stack in one profile layer: the application framework (`app-registry`, `page-registry`, `app-host`), the forum Host (`@veren/forum`, including the `forum` app with its `/apps/forum` pages and `forum__*` tools), and the Web page (`@veren/forum-ui`).

## When to use

Use it when a DSH profile should get the forum — as an app, as `forum_*` tools, and as a Web page — with one install and one toggle in the plugin manager. Skip it when you want only parts of the stack, or prefer composing the rows yourself.

## How composition works

The bundle declares `dsh.bundle.patch` pointing at `cordis.patch.yml`, which inserts the loader rows in dependency order: the app framework services first (the forum Host hard-injects `apps`, and its single-entry page registration relies on the page mirror that `app-host` wires), then the Host, then the Web page. Member plugins ship as plain dependencies without bundle declarations of their own, so this patch is the stack's only profile layer.

`tests/bundle.spec.ts` pins the patch declaration, the row order, and the dependency list.

## Development

```sh
pnpm --dir plugins/forum-bundle test   # patch-shape and manifest specs
```
