# notebook real-usage forensic audit (pre-registered protocol)

Status: **criteria frozen** (2026-11-03; this commit precedes all statistics)
Related: `docs/notebook-note-types.md` (gap backfill target), `docs/notebook-audit-results.md` (results, produced after statistics)

## 0. Task

Audit the process, not the snapshot. Rebuild "how the box is actually used" from the raw session logs of the stable node (`DSH_HOME=deepseek\.dsh`), produce a reproducible audit under pre-registered criteria, and upgrade the gap list from "judgment" to "findings with mechanical evidence". Three method defects of the previous audit round (2026-11-02, based on the storage end-state snapshot) are corrected here:

1. End-state only = survivorship bias (deleted cards and refused writes are invisible);
2. Post-hoc attribution (baselines chosen after seeing the data);
3. "64% residue" was eyeballed, with no operationalized rule.

## 1. Raw material (the audit eats only these; no digested aggregates)

| Material | Location | Use |
| --- | --- | --- |
| Session logs | `deepseek\.dsh\sessions\<scope>\<sessionId>\session.v4.jsonl.zstd` (multi-frame zstd) | Event table: `tool/call` (name/callId/arguments/time) ⋈ `tool/result` (by callId) |
| Storage raw rows | `deepseek\.dsh\storages\notebook.json` (tables.notes / tables.links) | End-state rows + survivorship denominator |
| Adjacent domains | `storages\task_center.json`, `app_pages.json` | Whether cards were consumed by tasks/pages |
| Current implementation | `plugins/notebook/src/` (841c630 line) | Instrument spec: code semantics of stale/riddle/reclassify |
| Primary external numbers | Bielefeld lecture PDF (20k+30k cross-refs / 24k+66k cards); sspai.com/post/95590 (1282 links / 483 cards) | Baselines cite primary numbers only |

## 2. Pre-registered criteria (frozen; no edits after statistics)

### 2.1 Operationalized residue/real rule

- **Mechanical rule (script-executed, deterministic)**: `title ∪ body` matches `/(验收|回归|验证|探针|rc\d|probe|verify|smoke)/i` → **R** (verification residue); otherwise **T** (true content).
- **Boundary frozen in advance**: cards whose title contains `rc6` are R even if the body holds real content — the rule precedes content intuition.
- **Dual-rater cross-validation**: two independent raters (neither sees the other's verdicts nor the mechanical rule) classify every end-state card as residue vs true content; agreement with the mechanical rule is reported. **Agreement ≥80% → the mechanical rule may pre-screen the G1 cleanup channel; <80% → reference only, cleanup requires human review.**
- The raters validate the **detector**, not re-classify: G1's proposed residue channel needs a validated pre-screener.

### 2.2 Operationalizable face of title discipline

Chinese "assertive sentences" resist mechanical judgment, so test the harder proxy instead: **metadata in titles**. Rule: title matches `/[0-9]{2,}|%|[0-9]{4}[-年]|[0-9]+\.[0-9]/` → "title carries metadata".

### 2.3 Flywheel funnel stages (event table × end state)

| Stage | Operational definition | Source |
| --- | --- | --- |
| F1 captured | distinct card ids from successful `create`/`capture` events | event table |
| F2 processed | cards touched again ≥1 time (update/read/find/backlinks hits) | event table |
| F3 linked | end-state cards with ≥1 link (in or out) | notebook.json |
| F4 reused | cards read/listed ≥7 days after creation | event table × time |
| F5 compounded | cards that become the link target of a **younger** card | links × createdAt |

### 2.4 Falsifiable predictions (written before the numbers; results report PASS/FAIL only)

- **P1** Among true (T) cards, "title carries metadata" share < 1/3. (FAIL → G3/G7 confirmed)
- **P2** F5/F1 ≥ 1/3 (one third of cards eventually become link targets of later cards — the wheel turns). (FAIL → evidence the flywheel is idle)
- **P3** True-card link density ≥ 1.0 links/card (primary baselines: Luhmann lower bound ≈0.56, sspai 2.65). (FAIL → density deficit confirmed)
- **P4** The logs contain ≥1 notebook tool refusal (link-unresolved / title-conflict / card-referenced / note-not-found) — the discipline surface really intercepted on the live node.
- **P5** Survivorship < 100%: successful create events > end-state rows (cards were deleted).

### 2.5 Design claims demoted to hypotheses (each verified)

- **H-A** "Write-time discipline: links must already exist" → check: all link rows resolve + the link-unresolved refusal face demonstrably fired in logs.
- **H-B** stale = no inbound links and older than 7 days (STALE_DAYS=7) → code-line citation + recomputation against data.
- **H-C** "Classification is a query, not a schema" (pre-rc.1 stance) → already overturned by the kind column; recorded as design drift, not failure.

## 3. Method and tools (deterministic)

1. **Extraction**: zstd CLI (v1.5.7) per session → Node line-by-line JSONL parse → keep only `tool/call`/`tool/result` whose name contains `notebook__` → event-table JSON (session/time/tool/args/result code).
2. **Analysis**: one deterministic script committed at `plugins/notebook/scripts/audit-forensics.mjs`, reading notebook.json raw rows + the event table directly, emitting a JSON readout; reruns reproduce identical numbers.
3. **Mechanical evidence**: gap claims supported by grep/code-line citations/existing test results; no "I believe".
4. **Survivorship**: F1 successful creates vs end-state rows; the difference is itemized (deleted/refused attempts).

## 4. External adjudicators (acceptance is not ours to grant)

1. Reproduction: anyone rerunning the script gets the same numbers (command in the results doc).
2. Pre-registration ordering: this file's git commit timestamp precedes any statistics commit.
3. The ≥80% agreement threshold adjudicates the mechanical rule's usability.
4. Every gap carries mechanical evidence or an explicit overturn record.
5. All baselines primary-checkable (URL + numbers).

## 5. Prediction register (for the rc.1 real-machine acceptance leg)

- **PR1** The card audited as T and project-shaped (expected: the pricing draft) is actually moved once the reclassify path lands.
- **PR2** After the orphan-count gauge (G4) lands, the stable node's first reading equals this audit's end-state orphan count (3).
- **PR3** Within 14 days of ledger going live, the G1 residue channel lists every mechanically-R card (8 at current end state, if dual-rater agreement holds).

## 6. Deliverables

- `docs/notebook-audit-results.md` + Chinese twin: results, PASS/FAIL table, gap re-audit, reproduction commands.
- Upgraded gaps backfilled into `docs/notebook-note-types.md` §4/§6 (both languages).
- Script `plugins/notebook/scripts/audit-forensics.mjs`.
