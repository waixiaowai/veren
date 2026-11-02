# notebook forensic audit results (pre-registered protocol execution record)

Status: complete (2026-11-03); criteria frozen in `docs/notebook-audit-forensic.md` (commit 5600d56, preceding all statistics here)
Data face: stable-node end state 13 cards (11 storage-default permanent + 2 fleeting) / 8 link rows; event table 45 sessions, 166 notebook tool calls

## 0. Reproduction commands

```bash
# Extract the event table (zstd CLI v1.5.7; reruns reproduce)
node plugins/notebook/scripts/audit-extract.mjs "deepseek\.dsh\sessions" <out>/events.json
# Deterministic readout (two runs byte-identical, verified)
node plugins/notebook/scripts/audit-forensics.mjs "deepseek\.dsh\storages\notebook.json" <out>/events.json <out>/readout.json
```

## 1. Classification and dual raters (§2.1)

Frozen rule (title∪body regex): **R=11 / T=2**. Independent blind raters (neither saw the other or the rule):

| Card | Frozen rule | Rater A | Rater B |
| --- | --- | --- | --- |
| playbook / pricing draft | T / T | true / true | true / true |
| 8 acceptance cards (2.0.3 …) | R | residue | residue |
| rc6 riddle pair | R | residue | **true** (bodies carry real data) |
| **Learning is an independent research process** | **R (false positive)** | **true** | **true** |
| rc7 fleeting pair | R | residue | residue |

Agreement: rule×A 12/13=92.3%; rule×B 10/13=76.9%; A×B 11/13=84.6%. **Verdict: below the autonomous pre-screening bar** — the single systematic false positive is the box's best card (the body phrase "验证发生在输出侧" trips the rule word). **The title-only variant matches rater A 13/13** (R=10/T=3) and is the recommended G1 pre-screener, with a mandatory human final gate.

## 2. Flywheel funnel (§2.3)

| Stage | n | Key members |
| --- | --- | --- |
| F1 captured | 18 | card ids minted by successful write/capture (29 write_note calls) |
| F2 processed | 13 | every end-state card touched at least once |
| F3 linked | 8 | — |
| F4 reused (≥7d) | 3 | playbook (true) + 2.0.3 验收 + 2.0.4 回归 (verification re-reads). **The "Learning" card was never touched again after creation** |
| F5 compounded | 5 | playbook, pricing draft, 2.0.3 验收, rc1 link card, rc1 rename card |

## 3. Survivorship (§3.4)

18 minted ids → 6 deleted (5× "真机验收" + 1× "临时草稿", all pure test debris) → 12 surviving + 1 predating the earliest surviving log (2.0.3 验收, smoke era) → 13 final. **Deletion is real and deleted only residue** — the box self-cleaned during testing, but with zero tool support (manual reverse-link-order deletion).

## 4. Refusal surface (§2.4 P4)

42 error results: note-not-found 16 (reads of deleted cards), **link-unresolved 4** (write-time discipline intercepted on the live node), unknown-tool 8 (2.0.6-era mount races, fixed historical noise), other 14 (legacy wrapper / page-assembly noise). Highlight evidence: a capture carrying a dangling `[[还不存在的卡]]` was refused with a live "existing similar titles" suggestion; a **fleeting card used as a link target** was refused — behavioral confirmation that fleeting stays off the graph.

## 5. Pre-registered prediction verdicts (§2.4)

| # | Claim | Observed | Verdict |
| --- | --- | --- | --- |
| P1 | True-card title-metadata share < 1/3 | 1/2 = 0.50 (playbook title carries date + prices) | **FAIL** → G3/G7 confirmed |
| P2 | F5/F1 ≥ 1/3 | 5/18 = 0.28 | **FAIL** → evidence the flywheel is idle |
| P3 | True-card density ≥ 1.0 (frozen text did not pin the counting rule; all three readings reported) | all-links/T=4.0; touching-T/T=2.5; **out-links/T=0.5** (baseline-comparable) | **FAIL** (strict reading; Luhmann lower bound 0.56) |
| P4 | ≥1 notebook refusal in logs | 42 (incl. link-unresolved×4) | PASS |
| P5 | Survivorship < 100% | 18 minted vs 13 final | PASS |

2 PASS / 3 FAIL — the discipline face (it intercepts) holds; the growth face (link density, title discipline, re-contact) fails across the board.

## 6. Design-claim hypotheses (§2.5)

- **H-A write-time link resolution: holds**. End-state links unresolved=0; 4 link-unresolved refusals in logs prove the interception face works.
- **H-B stale = no inbound & >7 days: holds**. `STALE_DAYS=7` (graph.ts:281, staleView :299); script recomputation = ["2.0.4 回归"], matching the rule.
- **H-C "classification is a query, not a schema"**: superseded by the kind column (types.ts:71 NoteKind); recorded as design evolution.

## 7. Gap re-audit (previous G1-G7 → evidence-backed upgrades)

| # | Verdict | Mechanical evidence |
| --- | --- | --- |
| G1 no residue cleanup channel | **held + hardened**: no cleanup face (all 16 remotes enumerated); the frozen rule would kill the best card → pre-screener must be title-anchored + human-gated | §1 rater table |
| G2 no permanent→project reclassify | **held**: promote only eats fleeting (lifecycle.ts:114), archive only project (:150); no reclassify remote | grep evidence on file |
| G3 title discipline missing | **held**: zero title guidance in tool descriptions (grep = 0 hits); P1 FAIL behavioral evidence | grep + §5 |
| G4 gauge blind to orphans | **held**: no orphanCount anywhere in src (only a doc word at graph.ts:293); measured orphans 5/13 | grep BoxStatsView |
| G5 riddle blind test needs organic data | **held**: rc6 pair created 4 s apart (13:23:50/54) = manufactured riddle | event timestamps |
| G6 ledger zero history | **held**: end-state notebook.json has no ledger table; promoteNote calls across all logs = 0 — the lifecycle face has never been used on the live node | storage keys + tool histogram |
| G7 metadata out of titles | **held**: anchor field present (types.ts:83); P1 FAIL | §5 |

New: **N1** lifecycle face (capture/promote/archive) has zero live usage — rc.1 acceptance must include one real promote and one real archive; **N2** fleeting-as-link-target refusal confirms the off-graph design behaviorally (tool hints should explain this to the model).

## 8. Prediction register (for the rc.1 real-machine acceptance leg; §5)

- **PR1** The pricing draft (audited T, project-shaped) is actually moved once reclassify lands.
- **PR2** After the orphan gauge lands, the first reading = **5** (this audit's end-state orphan count; the freeze-time parenthetical "3" was based on the stale 11-row snapshot — the node gained 2 fleeting cards since; the end-state recomputation governs).
- **PR3** Within 14 days of ledger going live, the residue channel (title-anchored pre-screen + human gate) lists all 10 R cards.

## 9. Backfill points for the note-types task

1. Migration backfill (task §4): all 13 existing cards lack kind, defaulting to permanent; the cleanup channel follows G1' (title-anchored pre-screen + human review) — never fully automatic deletion; this audit proves body-word false positives are a real risk.
2. Reclassify (task §3): the transition must exist with preconditions (→project requires an anchor; →fleeting forbidden), or the pricing draft can never enter the project lifecycle.
3. Gauges (task §6): BoxStatsView gains orphanCount; the audit's funnel numbers are the "before" baseline (F1=18/F4=3/F5=5; P2/P3 FAIL mark the pre-improvement line).
4. Blind tests (task §7): riddle validation observes naturally grown clusters; lifecycle acceptance must include one real promote and one real archive.
