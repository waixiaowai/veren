# @deepseek-ai/dsh-graph-bundle

Ships the whole DSH graph plugin family as one installable DSH bundle. Its `dsh.bundle.patch` mounts the DAG kernel, the node approval service, the flow engine, the canvas data source, the YAML flow loader and its parser provider, the storage seam, the generic tool node and the model-facing graph tools, and its `tarballs/` carry every package those rows load. Use it to put the family into a DSH profile in one step; depend on the individual `@deepseek-ai/dsh-graph-*` packages instead when you compose a host of your own.

## What it provides

- **One bundle layer** (`cordis.patch.yml`) — a single `insert` of the rows `veren-yaml-parser`, `graph-kernel`, `graph-flow-approval`, `graph-flow-engine`, `graph-flow-canvas`, `graph-flow-node-tool`, `graph-flow-yaml`, `graph-flow-storage` and `graph-tools`. The rows are addressed by id, so a later bundle layer or the profile's own `cordis.patch.yml` can override any of their configs. `graph-flow-canvas` is a read-only projection service: it projects static flow structure and live per-node status, and stores no layout. `graph-flow-approval` lets a node that needs authorization really suspend (60 s default timeout, overridable per row).
- **Self-contained tarballs** (`tarballs/*.tgz`) — each package built with `pnpm pack`. Packing rewrites `workspace:*` dependencies into bare versions, so the target profile needs pnpm `overrides` pinning every `@deepseek-ai/dsh-graph-*` and `@veren/*` package it carries to its own copies.

## Install into a DSH profile

Install the bundle as a **directory**, never as a packed tarball: pnpm resolves a package's own `file:./tarballs/*.tgz` dependencies against the project doing the install, so a tarball-installed bundle cannot find them. Concretely, with `$DSH_HOME` set to the target home:

1. Copy this directory to `$DSH_HOME/packages/dsh-graph-bundle`.
2. Add `"@deepseek-ai/dsh-graph-bundle": "file:../../packages/dsh-graph-bundle"` to `$DSH_HOME/profiles/<profile>/package.json`.
3. Append `@deepseek-ai/dsh-graph-bundle` to that manifest's `dsh.profile.bundles`.
4. Add an `overrides` entry under `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` for every `@deepseek-ai/dsh-graph-*` and `@veren/*` package this bundle carries, pinned to `$DSH_HOME/packages/*.tgz`.
5. Stop the node, run that profile's pnpm install, start the node again.

Refreshing the tarballs after a source change is a `pnpm pack --pack-destination <this dir>` per package; there is no generator script.

This directory is excluded from the repository pnpm workspace (`!packages/graph/bundle` in `pnpm-workspace.yaml`) for the same reason it cannot be installed as a tarball — see the comment there.

## Non-goals

No runtime code, no build step and no tests: it is a shipping artifact. It carries the canvas data source, not a visual canvas — no renderer, no layout algorithm and no persisted coordinates. It does not choose a storage backend or a flow source; those stay deployment choices (`@deepseek-ai/dsh-graph-flow-storage` config, `@deepseek-ai/dsh-graph-flow-yaml` `files`).

See [README.cn.md](./README.cn.md) for the Chinese documentation.
