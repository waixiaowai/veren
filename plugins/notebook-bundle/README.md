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
    - id: notebook-ui
      name: '@veren/notebook-ui'
```

Order matters: the Host owns the storage domain, the `notebook` Remote namespace,
and the tools; the page talks to that namespace.

Neither member declares `dsh.bundle.patch`, so this bundle is the stack's only
profile layer and installing it cannot double-insert a row. The members ship as
plain dependencies.

## Application layer

The Host member now also registers the `notebook` application (pages under
`/apps/notebook/...` plus `notebook__*` page tools) when the profile provides
the application registry (`ctx.apps`). That registry is *not* a bundle member:
compose an app-hosting bundle such as `plugins/app-host-bundle` alongside this
one to get the pages, or install the Host alone for a tools-only notebook — the
layer degrades to a logged warning instead of failing the profile.

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
