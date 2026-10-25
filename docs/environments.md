# Environment Tiers: Test / Staging / Production

> One home = one environment. Environments are isolated physically via
> `DSH_HOME` — storages, sessions, credentials, and the pnpm store never
> cross. This document is the single authority for what each environment is
> for and how to build one.

## The whole picture

| | Test | Staging | Production |
| --- | --- | --- | --- |
| Answers the question | "does this change run?" | "is this release safe to ship?" | "is the user's daily setup good?" |
| Location (DSH_HOME) | `deepseek\.dsh` | `deepseek\.dsh-staging` | `~\.dsh` (the desktop app) |
| Profile | `web` | `web` (isolation is home-level; the name is irrelevant) | `desktop` |
| Port | 3080 | 3100 | managed by the desktop app (runtime 54224) |
| How it starts | from source (`dsh web`) | from source (`dsh web`) | the desktop app itself |
| Plugin source | registry `^2.0.x`, follows every publish | registry **exact pins** (the release-train versions) | the desktop plugin market (user-driven) |
| Data | disposable, wiped and rebuilt at will | **long-lived, survives upgrades** (the rehearsal's core asset) | real user data, sacrosanct |
| Who may touch it | agents / scripts freely | agents may rehearse upgrades; wiping needs an explicit instruction | **no CLI / no scripts, ever** (the AGENTS.md iron rule) |
| When it breaks | wipe and rebuild | roll the pin back one version and reinstall | the user reinstalls the previous version from the market |

## Three isolation iron rules

1. **Every environment gets its own DSH_HOME** — never shared. Storages,
   sessions, and credentials live and die with the home.
2. **Every profile gets its own `.npmrc` store-dir** — pnpm hard links never
   cross environments (`package-import-method=copy` on top; no path sharing
   with the desktop's node_modules may ever appear).
3. **Credentials only ever flow OUT of `~/.dsh`, never back** — both
   `.credentials.yaml` and the `//npm.veren.top/:_authToken` line are copied
   in that one direction; a token never lands in a committed file.

## The promotion pipeline (one version's life)

```
workspace change
  → gates: vitest + typecheck + check:* all green
  → node market/release.mjs publishes to https://npm.veren.top/
  → [TEST] the ^2.0.x range follows automatically; smoke it (boot + one GUI probe)
  → [STAGING] move the pin to that version, install, restart,
      run the AGENTS.md real-machine checklist, verify the upgrade path
      over long-lived data
  → pass → sign off in RELEASE-NOTES.md (date / versions / harness commit /
      checklist results)
  → [PROD] the user clicks update in the desktop plugin market — the agent's
      job ends there
```

Fail → roll staging's pin back to the previous version, fix, walk the lane
again.

## Per-environment details and setup

### Test — already exists, do not rebuild

The daily proving ground: development verification, automated tests,
unattended acceptance. It can (and should) take the most aggressive changes
because wiping it is free. AGENTS.md's「稳定测试节点」section is its single
authoritative definition — commands live there, not here.

**One boundary you must know**: plugin pins say nothing about the host — both
environments run `deepseek/deepseek-harness` from source, so harness-side
changes (the event-forwarding allowlist, for example) reach test and staging
**at the same moment**. Any acceptance that involves host behavior must
record the harness commit at sign-off
(`git -C deepseek/deepseek-harness rev-parse --short HEAD`).

### Staging — built once

Purpose: release rehearsal. Exact about-to-ship versions over long-lived
data, walking the full upgrade path and the acceptance checklist — the last
gate before sign-off.

**Setup (one-time, about two minutes):**

```bash
# 1. Generate the home: directory skeleton + read-only credentials copy +
#    a dedicated .npmrc (private store + token)
node scripts/env-init.mjs --home deepseek/.dsh-staging --port 3100

# 2. First boot (creates the profile skeleton)
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh-staging' \
  pnpm --dir deepseek/deepseek-harness dsh web --port 3100 --no-open

# 3. Install the release-train versions (exact pins, through the proper
#    plugin-add flow: compatibility checks + bundle patch rows)
cd deepseek/deepseek-harness
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh-staging' \
  node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add \
  @veren/app-host-bundle@2.0.10 @veren/task-workbench@2.0.10

# 4. Restart to load, confirm no activation errors in the log, probe 401
```

**Upgrade rehearsal (after every publish):** record the current @veren ranges
in `profiles/web/package.json` → move the pins to the new version →
`pnpm install` inside the profile dir (the `.npmrc` already points at the
private store) → restart → run the AGENTS.md real-machine checklist → sign
off or roll back in RELEASE-NOTES.md.

Sign-offs append to `deepseek/.dsh-staging/profiles/web/RELEASE-NOTES.md`:
date, version matrix, harness commit, per-item checklist results, and the
verdict (signed / rolled back, with the reason).

### Production — not built, not touched

Production **is the desktop app** (`~/.dsh`, profile desktop). We do not set
it up; it carries the user's real daily work, and its upgrade path is exactly
one: **the user operates the desktop plugin market themselves**. The complete
boundary for agents and scripts:

- Allowed: **read-only** (reading its `.npmrc` for the token, reading
  credentials as the copy source)
- Forbidden: any `dsh plugin` write, any direct file edit, any process
  management — the iron rule in AGENTS.md's「特别注意」section; a wrong
  DSH_HOME is self-destruction

## Port allocation

| Port | Purpose |
| --- | --- |
| 3080 | Test (the stable node) |
| 3100 | Staging |
| 3200 | Reserved (load / soak — clone the staging recipe under a new home when needed) |
| 54224 | Desktop runtime (self-managed, hands off) |

## Command quick reference

```bash
# Test (daily)
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh' \
  pnpm --dir deepseek/deepseek-harness dsh web --port 3080 --no-open

# Staging (release rehearsal)
DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh-staging' \
  pnpm --dir deepseek/deepseek-harness dsh web --port 3100 --no-open

# Publish (idempotent; published versions are skipped)
node market/release.mjs

# Initialize any new environment
node scripts/env-init.mjs --home deepseek/.dsh-<name> --port <port>
```
