# @veren/baidu-pan-bundle

The Baidu Netdisk stack's **composition bundle** for DSH: a configuration-only package whose patch inserts the two loader rows the stack needs, in order.

Use this package when a DSH profile should gain the whole Baidu Netdisk capability — agent tools plus the web panel — in one install. Skip it when the profile composes those loader rows itself in its own patch.

## What it inserts

```yaml
- id: baidu-pan        # @veren/baidu-pan — tools, skill, sign-in flow, the baiduPan gateway
  config: { appKey: …, secretKey: …, root: … }
- id: baidu-pan-ui     # @veren/baidu-pan-ui — the sidebar panel
```

The panel comes second on purpose: its client half injects `remote.baiduPan`, which the server row's gateway mounts. This is the same ordering discipline `@veren/im-bundle` and `@veren/mail-bundle` follow — every member plugin ships as a plain dependency and the bundle owns the profile layer, so no member carries a `dsh.bundle` of its own.

## Install

```bash
dsh plugin --profile web add @veren/baidu-pan-bundle
```

Then edit the `config` block of the `baidu-pan` row in the profile's `cordis.patch.yml` to carry your open-platform `appKey`/`secretKey` (`/apps/bdpan` is the default authorized root) and restart the host. Until a real app triple is in place the plugin refuses to start — misconfiguration fails loud.

## Development

Nothing builds here. `package.json` carries `dsh.bundle.patch`, and `cordis.patch.yml` is the layer itself; source of truth for every behaviour is the two member packages:

- [`../`](../README.md) — the server plugin
- [`../ui`](../ui/README.md) — the web panel

Pack the whole stack for a profile install with:

```bash
node plugins/baidu/scripts/pack-stack.mjs
```

It emits all three tarballs into one directory and rewrites this package's member dependencies to `file:` references, because `workspace:*` cannot resolve outside the workspace.
