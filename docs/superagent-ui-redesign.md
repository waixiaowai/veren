# dsh-superagent Panel UI Redesign Task (professional designer standard · zero functional change)

> Status: ready to execute. Four-question deepening completed (2026-11-03); this file is the rewritten task.
> 中文版：[superagent-ui-redesign.cn.md](superagent-ui-redesign.cn.md)

## 0 One sentence

Rearrange the six-tab management panel from "data listing" into a triage surface, using only the DSH host's own design-system vocabulary, with zero loss of information or function. The core defect is not "ugly" — it is "no composition".

## 1 Design propositions (the first basis for the redesign)

One sentence per tab stating the decision the user comes here to make; ordering and hierarchy derive only from this:

| Tab | The decision the user comes to make |
| --- | --- |
| Overview | Anything needing me? Is the system healthy? Where is work flowing? (3-second three questions) |
| Sources | Are all channels connected? What is leaking (dropped)? |
| Triggers | Which threads await judgment? Is recent flow normal? |
| Evals | Is the decision history healthy? Any backlog? |
| Execution | Where is each ticket? Is anything stuck? |
| Settings | Can it run with less configuration? |

When unsure where information belongs, return to this table — never to aesthetic intuition.

## 2 Current-state forensics (verified code facts)

- `src/client/` is 27 files ≈ 4400 lines; `client.css` is 382 lines — **over the 300-line hard cap; this task must split it** (by vocabulary domain, updating css.d.ts accordingly).
- Existing engineering foundation (redesign **must not regress**; compose on top of it): `--dsw-alias-*` / `--dsw-static-*` host tokens, focus-visible rings, 640px container breakpoint, prefers-reduced-motion, tabular-nums, bilingual locales, glossary modal.
- Overview defects (confirmed by live screenshot):
  - Zero state = one 12px gray line + ~90% whitespace; no verdict, no anchor;
  - 14px metric values vs 12px labels read at nearly equal weight — metrics look like footnotes;
  - `.dt-stat-value` is always label-primary; numbers do not encode health;
  - No system-level "pulse" verdict bar; four sections ordered by data structure, not decision priority.
- Functional surface = the information contract: `GET overview` returns `person[] / problems[] / flow{received,filtered,judged,accepted,dropped} / executor{running,maxWorkers,queued,idle}` + `setup`; conditional rendering (dropped only when >0, executor-waits-on-setup hint, problems section only when problems exist) and every action (requeue / dismiss / resume / check-setup / detail links) are part of the contract.

## 3 Phases (diagnose before prescribing; no code edits before Phase 1 ends)

### Phase 0 — Before-evidence matrix

- Capture on the stable test node for real (`DSH_HOME=deepseek\.dsh`, port 3080, the only legitimate verification path):
  **6 tabs × light/dark × 3 widths (1280 / ~900 / ≤640) × key states (empty / loading / error / with data / paused)**.
- Screenshots via `scripts/cdp-shot.mjs` (port 9222) or browser-use automation; this is the "before" baseline, archived in the repo.
- Non-zero states via **least-invasive real injection** (e.g. `POST executor/pause` for the paused problem, trigger requeue/dismiss, breaking a credential for the setup problem); cells that cannot be produced are marked "not evidenced" with a reason — **no fabricated-data screenshots**.

### Phase 1 — Defect ledger (no code changes)

- Heuristic evaluation (Nielsen's ten) + blur/squint test (visual hierarchy audit) over the baseline;
- Produce a defect ledger graded **P0 answerability / P1 hierarchy & composition / P2 polish**, each entry tied to a §1 proposition or §2 fact;
- Produce the **information contract inventory**: a numbered list of every field, action, and route currently rendered across the six tabs (checked item-by-item after the redesign).

### Phase 2 — Vocabulary-layer redesign (interface inventory)

- Inventory every reusable element: Section / Stat / Card / Row / Tag / Dot / Empty / LoadState / Banner / Pulse (new) …;
- Split and rewrite `client.css` into vocabulary-domain files (suggested tokens / controls / sections / pages, each ≤300 lines);
- Pin the **state→color semantic mapping** (healthy→success/idle, needs-attention→warn, failure→error, running→business); pulse bar, state dots, and value coloring all take from this mapping;
- Metric scale: two-tier value/label sizing (values notably larger, tabular-nums), zeros de-emphasized (caption color), non-zeros emphasized (primary color);
- Discipline: zero hardcoded colors/font sizes; spacing on the 4/8pt grid; type ≤5 sizes.

### Phase 3 — Overview flagship recomposition

- Composition order = decision priority: **pulse verdict bar** (one system-level verdict + key counts, colored by the mapping) → **attention queue** (tickets + problems, with their actions) → **last-24h flow** → **executor load**;
- Empty/loading/error/with-data are each full compositions: the zero state gives "all quiet + last activity + next step", not a gray line;
- Every field, conditional, action, and route checked item-by-item against §2.

### Phase 4 — Remaining five tabs, vocabulary pass

- Consume Phase 2 vocabulary only; fix hierarchy and composition, no private new components; re-capture the corresponding matrix cells after each tab.

### Phase 5 — Adjudication gates (all must pass)

1. **After-screenshot matrix** (same protocol as Phase 0) archived side-by-side with before;
2. **Contrast report**: WCAG ratios computed programmatically from theme tokens, body text ≥4.5:1;
3. **5-second blind test**: a cold, unprimed agent session sees only the after screenshots and answers "anything wrong? where would you click?" — instant and correct to pass; Q&A archived;
4. **Information-contract diff is empty**: every Phase 1 item findable in the after UI (position may change; nothing may vanish);
5. **Machine gates green**: `pnpm check` (incl. function-length gate) + relevant specs + typecheck;
6. **Family attribution**: side-by-side with person-agent / task-workbench pages, the redesigned panel reads as "same family".

## 4 Hard constraints

- **Verifiable definition of "function unchanged"** = the Phase 1 contract inventory diffs empty after the redesign; `api.ts` / `route.ts` untouched; locale keys add-only; the diff confined to presentation (className / JSX composition / pure display components).
- Light/dark themes, ≤640px container breakpoint, reduced motion, and focus rings all preserved.
- Host tokens first; **no** private visual language (gradients, heavy shadows, odd radii, foreign fonts); no new dependencies.
- Files ≤300 lines, functions ≤30 lines; bilingual comments.
- The stable test node is the only one: `DSH_HOME=deepseek\.dsh`, port 3080; **never touch `~/.dsh`**.
- Reference corpus contributes composition ideas only (Vercel / GitHub Actions / Temporal / Dagster / Linear — overview, empty-state, status-semantics aspects); no code or skin copying.

## 5 Deliverables

- [ ] Phase 0 baseline matrix + Phase 5 after matrix (side-by-side)
- [ ] Phase 1 defect ledger + information contract inventory
- [ ] State-matrix document (tab × state, designed answer per cell)
- [ ] Split vocabulary-layer CSS + redesigned tsx
- [ ] Contrast report, blind-test record, gate outputs
- [ ] This file fully checked off
