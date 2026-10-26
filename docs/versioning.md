# Version Numbering and Bumping Convention

> Governs the release version itself: format, bumping, pre-releases, tags.
> For where dependency declarations go (`engines.dsh` / peer / dev /
> dependencies) see [dsh-plugin-versions.md](dsh-plugin-versions.md) — the two
> documents complement each other and do not overlap.

## 1. Format

SemVer: `MAJOR.MINOR.PATCH`, with a pre-release suffix `-rc.N` for high-risk
changes (`2.1.0-rc.1`). **No** build metadata, no `beta`/`alpha` words — the
DSH ecosystem's pre-release convention is `-rc.N` only, and we stay aligned.

## 2. Single version line (the release train)

**Every `@veren/*` package shares one version number, bumped in lockstep**
(today: the 2.0.x line, 79 packages on one number). Rationale: they are one
application's plugin family — published together (`market/release.mjs` walks
the closure in dependency order), installed together into a profile, and
referencing each other via `workspace:^` / registry ranges. Splitting versions
would turn "which package pairs with which" into guesswork.

- A bump always moves the whole family (the bump script rewrites all 79
  manifests + refreshes the lockfile).
- No package may jump ahead alone. A new package joins at the current line.

## 3. When to bump which digit

| Digit | When | Example |
| --- | --- | --- |
| **MAJOR** | Breaking contract changes: storage-domain format loses backward compatibility, event/Remote contracts removed or reshaped, the `engines.dsh` window moves (a new host becomes required), upgrade/uninstall paths need data migration | 2.x → 3.0.0 |
| **MINOR** | Backward-compatible new capability: new tools, new events, new page capabilities, new apps | 2.0.x → 2.1.0 |
| **PATCH** | Everything else: fixes, internal refactors, docs, tests — **the registry is immutable, so any content change must bump even a one-line doc change** | 2.0.9 → 2.0.10 |

Rule of thumb: **risks user data or the host contract = MAJOR; gives the user
something new = MINOR; everything else = PATCH.** When unsure, bump MINOR
(the conservative direction) — never stall.

## 4. Pre-release (-rc.N) policy

Exactly one class of change **must** ride an rc: **MAJOR (data migrations,
contract breaks)**. The flow:

```
publish 2.1.0-rc.1 → test follows the floating range → staging pins the rc
→ run the real-machine checklist + the data-migration rehearsal
→ pass → publish 2.1.0 (same number, suffix dropped — never a new number)
→ more changes during rc = rc.N+1; a breaking defect found in an rc =
  fix and stay on rc — an rc never converts to stable with the defect
```

MINOR/PATCH publish straight to stable (staging still rehearses them — that is
the pipeline's standing step, independent of rc).

## 5. Two red lines (lessons fixed in writing)

1. **The registry is immutable; never reuse a number.** A published version is
   never republished or overwritten (`npm publish` refuses, but **the working
   tree's version number** must be bumped *before* publishing — the
   2026-10-25 collision: the tree's 2.0.7 differed from the registry's
   published 2.0.7 and cost an hour to untangle). The rule: **content change →
   bump first → publish second**; the order is irreversible.
2. **No skipped numbers, no rollbacks.** Versions only move forward. A bad
   release = publish a PATCH fix and roll staging's pin back (the pipeline in
   docs/environments.md), not republishing the same number.

## 6. Relation to the other version surfaces (three surfaces, never mixed)

| Surface | Owned by | Example | Rule |
| --- | --- | --- | --- |
| `@veren/*` package versions | this convention (one line) | 2.0.10 | all of the above |
| `engines.dsh` contract | the DSH host compatibility window | `>=0.2.1-rc.2 <0.3.0` | independent of package versions; a package bump does **not** mean host-compatibility changed — only a window move means that, and that is always a MAJOR |
| harness version | the deepseek-harness repo's own line | 0.2.1-rc.2 (`687f282e86`) | evolves independently; staging sign-offs **must** record the harness commit (plugin pins cannot reach the host that shares the source tree) |

Also: the `version: '0.0.0'` seen in app definitions (`APP_DEFINITION`) is
historical residue — new apps take their package's version; to be unified, no
new debt.

## 7. Commit and tag conventions

- A version bump is its own commit: `chore(release): 2.0.11 - <one-line
  theme>` (precedent: the 2.0.9 and 2.0.10 commits).
- Release commits get a tag `v<version>` (`v2.0.10`), cross-referenced with
  the matching RELEASE-NOTES entry.
- Sign-offs: `deepseek/.dsh-staging/profiles/web/RELEASE-NOTES.md` (append-only;
  the flow lives in docs/environments.md).

## 8. Environment alignment (how each tier reads a version)

| Environment | Reading |
| --- | --- |
| Test (3080) | floating `^2.0.x`, follows every publish automatically — the first reader of every new version |
| Staging (3100) | **exact pins** (e.g. `2.0.10`) — the version signed off is the version users will get |
| Production (desktop market) | the user upgrades — the agent's job ends at sign-off |
