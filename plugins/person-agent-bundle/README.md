# Person Agent Bundle

Configuration-only DSH bundle that installs the Person Agent in one step. The app IS the whole stack: the bundle's patch inserts **one row** — `@veren/person-agent-app`.

| Dependency | Role |
| --- | --- |
| `@veren/app-host-bundle` | The application framework (app registry, page registry, task center, app-host assembly) — brought in as a dependency; it inserts its own framework rows |
| `@veren/person-agent-app` | Person Agent as an application: the bridge persona in the app instructions, a workbench overview and a workspace browser under `/apps/person-agent` |

The session/workspace maintenance tool builders (`@veren/person-agent-tool-session`, `@veren/person-agent-tool-workspace`) ship as runtime `dependencies` of the app — it imports them at runtime, and pnpm v10 does not auto-install peers, so a peer-only declaration left them orphaned on install (they stay in `devDependencies` for the tests). They are libraries, not plugin rows.

Use this bundle when a profile needs Person Agent as one installable, one-toggle unit. Skip it when you prefer listing the app row in your own patch.

## The stack's only bundle layer

The members ship as **plain dependencies** — none declares `dsh.bundle.patch` and none carries a `cordis.patch.yml`. After a `dsh plugin add`, the reconciliation therefore activates exactly one new layer from this bundle: its patch, with exactly one app row. A member can never double-insert a row behind your back. The tests in `tests/bundle.spec.ts` guard the invariants: exactly one app row, no preset row, no toggles, and no member exposing a bundle.

## One app, one shape: the bridge

Person Agent IS the bridge between the human and DSH. The bridge persona lives in the application's `instructions` (rendered as the `应用说明` line of every page session's PAGE block); the stop-and-delegate hard rule sits in the overview page's instructions. The session/workspace tools and the `renhua` writing skill mount into each page session's agent scope — a plain session sees none of them. There are no toggles.

## Install (test profile)

```powershell
pnpm --dir plugins/person-agent-bundle pack
$env:DSH_HOME='<stable-node-dir>'
dsh plugin --profile web add <path-to-tarball>
```

The bundle must appear in the profile's `dsh.profile.bundles`; its dependencies (the framework bundle and the app) install alongside it.

## Tests

```bash
pnpm --dir plugins/person-agent-bundle test
```

The specs guard the bundle's invariants: the patch inserts exactly one app row with no toggles, and the bundle stays the stack's only profile layer — no member declares its own bundle, and the tool builders stay libraries behind the app.
