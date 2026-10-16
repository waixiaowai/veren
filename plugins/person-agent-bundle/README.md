# Person Agent Bundle

Configuration-only DSH bundle that installs and composes the full Person Agent stack in one step:

| Member plugin | Role |
| --- | --- |
| `@veren/person-agent-preset` | Registers the Person Agent preset (persona + child-row roster) |
| `@veren/person-agent-dynamic-context` | Working memory: append-only dynamic context sections per session |
| `@veren/person-agent-tool-session` | Session maintenance tools (create / rename / fork / archive / pin) |
| `@veren/person-agent-tool-workspace` | Workspace maintenance tools (create / rename) |

Use this bundle when a profile needs the whole stack as one installable, one-toggle unit. Skip it when you prefer listing the four plugins row by row in your own patch.

## One preset, one shape: the bridge

The patch inserts **one row**. Person Agent IS the bridge between the human and DSH, so the delegating persona and both maintenance tool families are always on — there are no toggles and no second "manager" row. The bridge understands the user's need, picks the workspace, preset, provider and model, creates the working session, and reports its choices.

Sessions that previously selected the retired `person-agent-manager` preset keep their locked composition; new sessions pick `person-agent`.

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
