# Person Agent Bundle

Configuration-only DSH bundle that installs and composes the full Person Agent stack in one step:

| Member plugin | Role |
| --- | --- |
| `@veren/person-agent-preset` | Registers the Person Agent preset (persona + child-row roster) |
| `@veren/person-agent-dynamic-context` | Working memory: append-only dynamic context sections per session |
| `@veren/person-agent-tool-session` | Session maintenance tools (create / rename / fork / archive / pin) |
| `@veren/person-agent-tool-workspace` | Workspace maintenance tools (create / rename) |

Use this bundle when a profile needs the whole stack as one installable, one-toggle unit. Skip it when you prefer listing the four plugins row by row in your own patch.

## Tool policy: default off, per-preset opt-in

The patch inserts **two rows of the same preset plugin** with different identities:

- `person-agent` (default) — `withWorkspaceTools: false`, `withSessionTools: false`. The assistant reads and reports; it cannot create, rename, archive, or pin sessions/workspaces.
- `person-agent-manager` (opt-in) — both toggles `true`. A session only gets the maintenance tools when it explicitly selects this preset in the client picker.

Enablement is therefore decided by the preset a session picks, not by a global switch — nothing changes for existing sessions that already selected `person-agent`.

## Install (test profile)

```powershell
pnpm --dir plugins/person-agent-bundle pack
$env:DSH_HOME='<test-node-dir>'
dsh plugin --profile web add <path-to-tarball>
```

The bundle must appear in the profile's `dsh.profile.bundles`; its dependencies install alongside it so both preset rows resolve.

## Tests

```bash
pnpm --dir plugins/person-agent-bundle test
```

The spec guards the bundle's only invariant: the default row keeps every maintenance tool off and only the manager row turns them on.
