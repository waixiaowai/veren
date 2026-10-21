# @veren/forum-bundle

Configuration-only bundle that installs and composes the whole Forum stack: the forum Host (`@veren/forum`, including the `forum` app with its `/apps/forum` pages and `forum__*` tools) and the Web page (`@veren/forum-ui`).

## When to use

Use it when a DSH profile should get the forum — as an app, as `forum_*` tools, and as a Web page — with one install and one toggle in the plugin manager. Skip it when you want only parts of the stack, or prefer composing the rows yourself.

## How composition works

The bundle declares `dsh.bundle.patch` pointing at `cordis.patch.yml`, which inserts the Host row first (it owns the storage domain, the `forum` Remote namespace, the model-facing tools, and notification delivery), then the Web page. It does **not** insert any application-framework row: `app-registry`, `page-registry`, `task-center`, and `app-host` are owned exclusively by `@veren/app-host-bundle`, which this bundle declares as a dependency. The dsh plugin reconciliation turns every installed dependency that declares `dsh.bundle.patch` into its own profile layer, so installing the forum bundle pulls the framework in, and `app-host` is inserted exactly once no matter how many application bundles are installed alongside it (G1 dedup contract).

If the framework layer is missing (for example, someone stripped the dependency), the Host row does not degrade silently: it hard-injects `apps`, stays pending, and shows up as a not-enabled plugin plus a boot-log warning.

Member plugins ship as plain dependencies without bundle declarations of their own. `tests/bundle.spec.ts` pins the patch declaration, the row order, the absence of framework rows, and the dependency list.

## Development

```sh
pnpm --dir plugins/forum-bundle test   # patch-shape and manifest specs
```
