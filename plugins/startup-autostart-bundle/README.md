# Startup Autostart Bundle

Configuration-only DSH bundle that installs and composes the full Startup Autostart stack in one step:

| Member plugin | Role |
| --- | --- |
| `@veren/startup-autostart` | Host: startup trigger, item storage, and the `startup` Remote API |
| `@veren/startup-autostart-tool` | Model-facing tools: agents manage startup items through the Host |
| `@veren/startup-autostart-ui` | Web UI: the "startup items" sidebar page, talking to the Host |

Use this bundle when a profile needs the whole stack as one installable, one-toggle unit. Skip it when you want only the headless Host (`@veren/startup-autostart` alone), or prefer listing the three plugins row by row in your own patch.

## The stack's only bundle layer

The three member plugins ship as **plain dependencies** — none declares `dsh.bundle.patch` and none carries a `cordis.patch.yml`. After a `dsh plugin add`, the reconciliation therefore activates exactly one new layer: this bundle's patch. A member plugin can never double-insert a row behind your back.

The patch inserts **three rows in dependency order**: the Host first (it owns the startup trigger, storage and the `startup` Remote namespace), then the tools, then the UI. No row carries configuration — every member ships its own defaults. The tests in `tests/bundle.spec.ts` guard both invariants: three ordered, config-free rows, and no member exposing a bundle.

## Install (test profile)

```powershell
pnpm --dir plugins/startup-autostart-bundle pack
$env:DSH_HOME='<test-node-dir>'
dsh plugin --profile web add <path-to-tarball>
```

The bundle must appear in the profile's `dsh.profile.bundles`; its dependencies install alongside it so all three rows resolve by package name.

## Tests

```bash
pnpm --dir plugins/startup-autostart-bundle test
```
