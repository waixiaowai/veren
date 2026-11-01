# Optimization Plan: Gap Audit and Remediation (2026-11-01 review draft)

> Status: approved for execution (2026-11-01). Background: an architectural
> comparison audit against DeepSeek's official research prototype
> dsh-superagent-prototype (MIT, read-only reference at `deepseek/dsh-superagent`
> in this workspace). Chinese original: [optimization-plan.cn.md](optimization-plan.cn.md).

## 0 · Audit findings (where the gaps are)

Structural gaps (from the comparison):

| # | Gap | Evidence | Official reference |
| --- | --- | --- | --- |
| G1 | No shared reliability spine: task-center `service-delivery.ts` and im `core/src/queue.ts` hand-roll retry/idempotency/ordering; paid tuitions = receipt-arming race, `attempts` without dispose | Official `src/app/effects.ts` (161 lines) + outbox receipt table (idempotent ids / `behind` check / never-queue-twice) |
| G2 | No regression gate over the model-facing surface: PAGE blocks, mounted tool names and skill names are checked by hand | Official `tests/model-surface.spec.ts` |
| G3 | Decisions documented but not locked: docs/ has design drafts, but no "invariants + rejected concepts" layer and no docs↔code sync test | Official `tests/docs.spec.ts` (exhaustive enforcement) |
| G4 | No single-writer arbitration: plugins share storage domains with no claim mechanism | Official marks one writer per table / per health entry (`HealthBoard`) |
| G5 | In-memory state does not survive restart: workbench store resets (recorded 2026-10-25 acceptance) | Official keeps all state in SQLite + transactions |

Outstanding debts (remediation list): IM queue live-machine quartet (normal reply confirmation / triple-send / duplicate / host kill / terminal audit); unattended page contract wrap-up (3080 model leg, audit numbers, push); workbuddy-auth Phase 0 probe + 7 live checks; person-agent push + npm deprecate; tool-face actor dual-track lease defect; dsh-superagent wrap-up (gh CLI / 9 questions / hourly check).

## 1 · Scope ruling (what we do NOT do)

- No wholesale port of the official prototype: a 27K-line single-process POSIX monolith does not transplant into a cross-platform multi-plugin ecosystem.
- No rewrite of delivery surfaces into one framework: extract a shared core `@veren/effects` only; callers keep their semantics; im wires in only after task-center lands.
- No changes to the market/version/three-environment system (our lead; do not regress it to "align with official").
- AGENTS.md ruling: the current text ("no hard cap on source files per package; aggregate by responsibility") governs; the old 5-file exception no longer exists; no file edit needed.

## 2 · Four lanes

### S1 · Reliability core `@veren/effects` (P0)
- Raw material: official effects.ts semantics (enqueue inside transaction / kind+key coalescing / `Later` defers without counting a failure / exponential backoff / ordered blocking / quiet health / generation guard against overwrite) + outbox receipt semantics. MIT — port the semantics and credit the origin; do not vendor files.
- Method: standalone package, **dual backend** = in-memory (tests) + DSH storage adapter (runtime, no bundled sqlite); wire task-center first, im/core next (serial).
- Adjudication: a concurrency spec proving no loss / no duplication / no reordering across a process kill and restart; all task-center tests green; the live 3080 run merges with the "IM live quartet" acceptance.

### S2 · Model-surface gate `check:model-surface` (P1)
- Method: exhaustively compare each app page's PAGE block / map rows / mounted tool names / skill names against the registered faces, plus size budgets; wire into `pnpm check`; self-test follows the `check:gate-selftest` pattern.
- Adjudication: first report over the 18 unattended pages must **catch at least one real drift** to count as effective; catching none means the gate is too loose — rework it.

### S3 · Decision consolidation + docs sync (P1)
- Method: one `domain.md` per package (invariants table + rejected list), starting with task-workbench / im/core / app-host; new `check:docs`: every service/tool/event name a doc declares must exist in code (one direction only, avoiding over-engineering).
- Adjudication: gates green; every invariant points at at least one test name.

### S4 · Debt clearance (P0 quick wins)
| Item | Action | Adjudication |
| --- | --- | --- |
| IM live quartet | merged with S1 acceptance, one live run | TASK block + delivered in logs |
| Unattended contract wrap-up | 3080 model leg + audit numbers + push | origin ahead-of count back to zero |
| workbuddy-auth | user confirms Phase 0 probe → 7 live checks | probe evidence on file |
| person-agent | push + npm deprecate retired packages | installs resolve to new packages |
| actor dual-track defect | separate review task | red-green regression on file |
| dsh-superagent wrap-up | user installs gh → wrapper + 9 questions | `status` exit 3→0 |

## 3 · Ordering and parallel safety

S4 immediately → S1 (serial: package → task-center → im) → S2/S3 in parallel; S2/S3 share scripts/ so they merge into one lane.
Parallel rules: declare directory ownership first; each lane runs only its own tests, the main session runs the full `pnpm check` after lanes land; official sources are read-only and never vendored.
