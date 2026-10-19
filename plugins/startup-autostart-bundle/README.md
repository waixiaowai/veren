# Startup Autostart Bundle

Configuration-only DSH bundle that installs and composes the full Startup Autostart stack in one step:

| Member plugin | Role |
| --- | --- |
| `@veren/startup-autostart` | Host: startup trigger, item storage, and the `startup` Remote API |
| `@veren/startup-autostart-tool` | Model-facing tools: agents manage startup items through the Host |
| `@veren/startup-autostart-skill` | Guidance skill: teaches when to create an item, which action fits, and how the run rules behave |
| `@veren/startup-autostart-ui` | Web UI: the "startup items" sidebar page, talking to the Host |

Use this bundle when a profile needs the whole stack as one installable, one-toggle unit. Skip it when you want only the headless Host (`@veren/startup-autostart` alone), or prefer listing the four plugins row by row in your own patch.

## The stack's only bundle layer

The four member plugins ship as **plain dependencies** — none declares `dsh.bundle.patch` and none carries a `cordis.patch.yml`. After a `dsh plugin add`, the reconciliation therefore activates exactly one new layer: this bundle's patch. A member plugin can never double-insert a row behind your back.

The patch inserts **four rows in dependency order**: the Host first (it owns the startup trigger, storage and the `startup` Remote namespace), then the tools, then the guidance skill, then the UI. No row carries configuration — every member ships its own defaults. The tests in `tests/bundle.spec.ts` guard both invariants: four ordered, config-free rows, and no member exposing a bundle.

## The guidance skill

The skill row contributes one model-invocable skill named `startup-autostart`
through the profile's `ctx.skills` registry. It appears automatically in the
session skill catalog of every agent that can see the `skill` tool, on the next
step after the row activates; no per-agent setup is needed. Its routing text
loads it for "every start" requests and for list/add/change/disable/delete
requests, and explicitly declines one-off work, clock-time scheduling, and
questions that only ask what startup items are.

The row injects only `skills`. In a profile without the registry the row stays
**pending** — it never fails the boot that mounted it. Without
`@deepseek-ai/dsh-tool-skill` the skill is still registered, but no model can
see it. See [`../startup-autostart-skill/README.md`](../startup-autostart-skill/README.md)
for the full routing text, the session-level checklist, and the relationship to
the other three members.

## Install (test profile)

```powershell
pnpm --dir plugins/startup-autostart-bundle pack
$env:DSH_HOME='<test-node-dir>'
dsh plugin --profile web add <path-to-tarball>
```

The bundle must appear in the profile's `dsh.profile.bundles`; its dependencies install alongside it so all four rows resolve by package name.

## Tests

```bash
pnpm --dir plugins/startup-autostart-bundle test
```
