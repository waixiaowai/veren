# Person Agent Bundle

Configuration-only DSH bundle that installs and composes the full Person Agent stack in one step:

| Member plugin | Role |
| --- | --- |
| `@veren/person-agent-preset` | Registers the Person Agent preset (persona + child-row roster) |
| `@veren/person-agent-dynamic-context` | Working memory: append-only dynamic context sections per session |
| `@veren/person-agent-reanchor` | Periodic self-work re-anchor: a short numeric append-only notice after N analysis-only steps |
| `@veren/person-agent-tool-session` | Session maintenance tools (create / rename / fork / archive / pin) |
| `@veren/person-agent-tool-workspace` | Workspace maintenance tools (create / rename) |

Use this bundle when a profile needs the whole stack as one installable, one-toggle unit. Skip it when you prefer listing the five plugins row by row in your own patch.

## The stack's only bundle layer

The five member plugins ship as **plain dependencies** — none declares `dsh.bundle.patch` and none carries a `cordis.patch.yml`. After a `dsh plugin add`, the reconciliation therefore activates exactly one new layer: this bundle's patch. A member plugin can never double-insert a row behind your back.

The inserted preset row is also the whole integration: the preset definition itself composes `@veren/person-agent-dynamic-context`, `@veren/person-agent-reanchor`, `@veren/person-agent-tool-session` and `@veren/person-agent-tool-workspace` as per-session child rows, resolved from the profile's `node_modules` where pnpm installs them alongside the bundle. The tests in `tests/bundle.spec.ts` guard both invariants: one patch row, and no member exposing a bundle.

## One preset, one shape: the bridge

The patch inserts **one row**. Person Agent IS the bridge between the human and DSH, so the delegating persona and both maintenance tool families are always on — there are no toggles and no second "manager" row. The bridge understands the user's need, picks the workspace, preset, provider and model, creates the working session, and reports its choices.

Sessions that previously selected the retired `person-agent-manager` preset keep their locked composition; new sessions pick `person-agent`.

## Install (test profile)

```powershell
pnpm --dir plugins/person-agent-bundle pack
$env:DSH_HOME='<test-node-dir>'
dsh plugin --profile web add <path-to-tarball>
```

The bundle must appear in the profile's `dsh.profile.bundles`; its dependencies install alongside it so the preset row and its per-session child rows resolve.

## Tests

```bash
pnpm --dir plugins/person-agent-bundle test
```

The specs guard the bundle's two invariants: the patch inserts exactly one bridge-shaped preset row with no toggles, and the bundle stays the stack's only profile layer - no member declares its own bundle.
