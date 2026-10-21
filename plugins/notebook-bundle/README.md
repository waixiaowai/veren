# @veren/notebook-bundle

Configuration-only bundle that composes the complete private-notebook stack in
one profile layer.

## When to use it

Use this package when a DSH profile should get both the Host service with its
`notebook_*` tools and the Web page a person uses, installed as one unit. Skip it
if you want only the Host service, or if you compose the two rows in your own
patch.

## What it inserts

```yaml
- insert:
    - id: notebook
      name: '@veren/notebook'
    - id: notebook-app
      name: '@veren/notebook-app'
    - id: notebook-ui
      name: '@veren/notebook-ui'
```

Order matters: the Host owns the storage domain, the `notebook` Remote namespace,
and the tools; the application layer hard-injects `apps` and the `notebook`
service; the page talks to that namespace.

The bundle declares `@veren/app-host-bundle` as a dependency: that bundle owns
every application-framework loader row (`app-registry`, `page-registry`,
`task-center`, `app-host`), so installing the notebook bundle pulls the
framework in and `app-host` is inserted exactly once no matter how many
application bundles coexist (G1 dedup contract). Installing only
`@veren/notebook` gives a headless stack with no app face (G2 package split).

## Application layer

The application layer is its own member package, `@veren/notebook-app` (G2
package split): the `notebook` app (pages under `/apps/notebook/...` plus
`notebook__*` page tools) riding the Host service's public tools port. It is a
separate loader row, so a profile can install the Host alone (tools only) or
the whole stack — the boundary is visible in the plugin page either way.

## Installation

Install the bundle package into the target profile. In a test node the two member
packages are local tarballs, so `scripts/pack-local.mjs` produces a throwaway
bundle tarball whose dependency entries point at those tarballs:

```sh
pnpm --dir plugins/notebook pack --pack-destination plugins/notebook-bundle/tarballs
pnpm --dir plugins/notebook-ui pack --pack-destination plugins/notebook-bundle/tarballs
node plugins/notebook-bundle/scripts/pack-local.mjs plugins/notebook-bundle/tarballs
```

The committed `package.json` keeps `workspace:^` ranges, which is what a published
bundle needs. The generated tarball is a local artifact.

## Development

```sh
pnpm --dir plugins/notebook-bundle test
```
