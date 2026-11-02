# The Notebook as a Card Box — @veren/notebook × Zettelkasten Contract Design

> Status: **DESIGN DRAFT, PENDING REVIEW.** This document is the deliverable of the
> design task; it writes no business code. Every method claim cites a first-hand
> source (Appendix A); every contract decision carries an id (`D1`–`D12`) and names
> its rejected alternatives; every invariant (`I1`–`I10`) carries a test sketch.
> Implementation starts only after this document is reviewed and approved.
>
> 中文版同构镜像：[notebook-zettelkasten-design.cn.md](./notebook-zettelkasten-design.cn.md)

---

## 0. Decision summary

| id | decision | one line |
|----|----------|----------|
| D1 | entities | card = evolved `NoteRecord` (no new fields); link = derived from bodies, cached; hub = a derivation, not an entity |
| D2 | card identity | immutable uuid row key (as today) + **title unique per owner**, and the title is the link address |
| D3 | link syntax | `[[title]]`, strict store-time resolution, `\[[` escape; hand-rolled ~80-line scanner, no dependency |
| D4 | rename / delete / dangling | rename rewrites every referrer body and retargets the cache (`[[old]]`→`[[new]]`); delete refused while inbound links exist; no dangling link is ever stored |
| D5 | backlinks | derived, never source-of-truth; a disposable `links` cache table maintained on every card write (domain-level rejecting posture — see §3.5 note) |
| D6 | migration | none: the medium stays version 1, single layout — the additive tables and the `linksSyncedAt` global marker open v1 media natively; see the erratum in §3.6 |
| D7 | method adaptation | per-preset box kept; Folgezettel numbering dropped; the daily-processing rhythm becomes write-time discipline |
| D8 | tool face | keep all five tools; add exactly two (`list_backlinks`, `list_hubs`); tool descriptions carry the method |
| D9 | page face | first-screen messages gain link/backlink/hub sections; unattended-page contract untouched |
| D10 | anti-goals | not a task list, not full-text search, not a human wiki, not cross-preset sharing, not a markdown renderer |
| D11 | package & version | evolve `@veren/notebook` in place; MAJOR `3.0.0-rc.N` (error-code union widens; stored-data validity tightens) |
| D12 | merge/split | no primitives — the agent performs them through `rewrite_note`; dedicated tools rejected (YAGNI) |

---

## 1. As-built contract (the ground this design starts from)

Facts read from source, 2026-11-02 (not from memory):

- `plugins/notebook/src/storage.ts` — one storage domain `notebook`, **version 1**,
  one table `notes`, zod-validated, key `encodeURIComponent(owner)/<uuid>`
  (`noteKey`, `notes.ts:49`). A row that fails its schema rejects the whole domain
  open (authoritative-data posture).
- `plugins/notebook/src/types.ts` — `NoteRecord { id, owner, title, body, createdAt,
  updatedAt }`; error codes `notebook/storage-unavailable | input-invalid |
  title-required | body-too-long | note-not-found | conflict` (declared into the
  `RemoteErrorDetailsMap`).
- `plugins/notebook/src/notes.ts` — `MAX_TITLE_CHARS = 200`, `MAX_BODY_CHARS =
  100_000`, `EXCERPT_CHARS = 160`; `mintNoteId()` is `crypto.randomUUID()`;
  optimistic concurrency via `expectedUpdatedAt` (`ensureExpected`).
- `plugins/notebook/src/tools.ts` — five `defineTool` builders (`list_notes`,
  `read_note`, `write_note`, `rewrite_note`, `delete_note`); **the owner is read
  from the live Agent on every call and is never a parameter**; the tools carry no
  registration — the app is the single registration face.
- `plugins/notebook-app/src/app.ts` — app id `notebook`, `toolPrefix: 'notebook'`,
  two pages (`list`, `note`), tools mounted page-scoped via `meta.tools`
  composition (`notebook__<local>`), registration with reverse-order rollback
  (`registerAppSteps`).
- `plugins/notebook-app/src/pages.tsx` — one-shot `PageFC` bodies; owner resolves
  from the session header's `agentPreset`; first screen rides `agent.ctx.effect` +
  `agent.followup` (`source: 'app/page'`); unattended contract `list = L1`,
  `note = L2` with the page-scoped `task_take/complete/fail` face.
- `plugins/notebook-ui/` — the person-facing panel (list, editor, owner selector)
  over the same service methods.

**What is absent today**: no links of any kind; no uniqueness on `title`; bodies
are plain text with no markdown semantics anywhere in the family; no rendering
dependency exists in any of the three packages.

Migration mechanics available to us (harness
`packages/storage/storage-domain/src/spec.ts`): a domain declares `version` and
optional `compatibleVersions: readonly number[]` — *"older domain versions whose
stored records the current record schemas also accept … writes always stamp
`version`"*. `invalidRecords: 'backup-and-skip'` exists specifically for
*"domains whose records are disposable derived data"*. This is exactly the
machinery D5/D6 need; no migration code must be invented.

## 2. Method claims and their first-hand sources

The design honors or adapts these claims; it cites primaries, not the Ahrens
bestseller (see the caution below).

| # | claim (as we use it) | first-hand source | how this design honors it |
|---|----------------------|-------------------|---------------------------|
| C1 | *"It's best to create notes which are only about one thing—but which, as much as possible, capture the entirety of that thing."* | [Matuschak, Evergreen notes should be atomic](https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic) | one idea per card enforced by tool-description discipline; self-contendance adjudicated externally by the blind-read test (§10b) |
| C2 | *"It creates pressure to think carefully about how ideas relate to each other"*; links are *"many paths to move through idea-space"* | [Matuschak, Evergreen notes should be densely linked](https://notes.andymatuschak.org/Evergreen_notes_should_be_densely_linked) | dense linking made cheap and enforced: store-time resolution + `list_backlinks` |
| C3 | titles should be complete phrases — the title is the note's stable address | [Matuschak, Prefer note titles with complete phrases](https://notes.andymatuschak.org/Prefer_note_titles_with_complete_phrases) (title cited; the note's title *is* the claim) | **the title is the link address** (D2) |
| C4 | the box is *"a kind of second memory, an alter ego with which you can always communicate"*; a note *"is just an element that gets its value from being a part of a network of references and cross-references"*; disconnected notes *"will get lost in the Zettelkasten, and will be forgotten by the Zettelkasten"* | [Luhmann 1981, English translation](https://zettelkasten.de/communications-with-zettelkastens/) | `list_backlinks` + hub sections in the first screen are the box talking back (D7); orphan prevention is structural (I3) |
| C5 | Luhmann's boxes held **24,000 cards + 1,800 bibliographic entries** and **66,000 + 16,000**; hubs are *"an extensive list of links to the core Zettels"*, *"like highways between topics for the physical Zettelkasten"* | [Schmidt interview, The Money Is in the Hubs](https://zettelkasten.de/posts/zettelkasten-hubs/) | hubs are a **derived ranking** (`list_hubs`), not an entity (D1); scale target set at 10k cards/box (§8 I4 note) |
| C6 | real card ids are branch numbers (`21,3a7`-style Folgezettel) that encode physical placement | [Niklas-Luhmann-Archiv](https://niklas-luhmann-archiv.de) (scanned originals) | numbering is treated as a **paper-world constraint** and deliberately dropped (D7) |
| C7 | caution: the popular book is a personal reading of Luhmann, and parts of the productivity scene misread the method as storage technique | [Bob Doto, Tensions Between Zettelkasten & the Productivity Scene](https://writing.bobdoto.computer/tensions-between-zettelkasten-and-the-productivity-scene) | this design grounds every claim in C1–C6 primaries; Ahrens is used only as secondary literature, flagged as such |

**Explicitly not claimed**: the human psychology of "writing in your own words
elaborates memory" (C1's cognitive-science half). The primary writer here is an
agent (§4); we do not smuggle human-memory claims into an agent system. What
survives for agents is the **structural** half: atomicity, addressing, linking.

## 3. Data model contract

### 3.1 Entities (D1)

- **Card** — the evolved `NoteRecord`, **field-for-field unchanged**:
  `id, owner, title, body, createdAt, updatedAt`. A card is a plain-text body that
  *may* contain links; there is no markdown, no front-matter, no tags in v3.
- **Link** — has no stored source of truth. A link is a `[[title]]` occurrence in
  some card's body. Its existence is derived by parsing; a cache table holds the
  parsed projection for fast reads (D5) and is disposable.
- **Hub** — not an entity. A hub is any card with a high inbound-link count;
  `list_hubs` is a ranking over the derived link set (C5: Luhmann's own hubs were
  ordinary cards holding link lists).

Rejected: adding `tags`/`type`/`outbound: string[]` columns to `NoteRecord` —
every one of them is derivable from `body` and would create a second
source-of-truth to keep consistent (violates the single-writer discipline this
codebase already runs on).

### 3.2 Card identity (D2)

- Row key stays `encodeURIComponent(owner)/<uuid>` — immutable, as today; UI
  routes (`/apps/notebook/note/:noteId`) and existing ids keep working.
- **`title` becomes unique per owner** and is the link address. Uniqueness is
  enforced at `write_note`/`rewrite_note` with a new code
  `notebook/title-conflict` (message lists the conflicting card's id).
- A rename is a one-field update; because links address by title, **every
  inbound link follows automatically** (D4). This is the payoff of title
  addressing, and the reason we do not need Luhmann-style immutable branch
  numbers (D7).

Rejected: content-addressed ids (every edit mints a new id — pointless churn
when bodies are mutable by design); title-as-row-key (rename would move rows and
break the stable ids the routes already use); random-id link targets (opaque to
models — a model reading `[[a1b2c3…]]` learns nothing, while
`[[存储域迁移必须不丢行]]` is self-describing).

### 3.3 Link syntax and the parser (D3)

- Syntax: `[[title]]` — inner text trimmed, then matched **exactly** against the
  owner's card titles. Case-sensitive, Unicode-exact (Chinese titles are
  first-class addresses; no ASCII-slug mangling, no NFKC normalization).
- A `[[…]]` occurrence is a **link** iff its inner text is non-empty, contains no
  `[`, `]`, or newline, and is ≤ `MAX_TITLE_CHARS`. Everything else (including
  code snippets like `[[1,2],[3,4]]`, whose inner text contains `]`) is literal
  text and needs no escape.
- Explicit escape for the rare literal `[[like this]]`: write `\[[like this]]`.
  The backslash is stored verbatim (bodies are never rewritten by the parser);
  it only removes link semantics.
- Store-time resolution (I3): every link in a written body must resolve to an
  existing card title of the same owner, or the write is refused with
  `notebook/link-unresolved`; the refusal message lists up to five existing
  titles containing the fragment, so the model can self-correct.
- Parser: **hand-rolled scanner in a new `plugins/notebook/src/links.ts`**
  (~80 lines): `extractLinks(body): { title: string; offset: number }[]`.
- Wheel check (done, 2026-11-02): no markdown/remark/mdast/wiki-link dependency
  exists in `apps|packages|plugins` (grep over every `package.json`), and none of
  the three notebook packages has a rendering dependency. One syntax does not
  justify a parser library; adding one would import a second grammar this
  codebase would then have to maintain.

### 3.4 Rename, delete, dangling (D4)

> **Erratum (implementation, 2026-11-02).** The draft said a rename leaves
> referrer bodies unchanged — that contradicts title-as-address: `[[old]]` is
> literal text and would dangle the moment the title moved. The implemented
> semantics: a rename rewrites every referrer body (`[[old]]` → `[[new]]`,
> parser-aware, escapes untouched), length-checks all of them before the first
> put (whole-or-nothing), stamps the referrers' `updatedAt`, and retargets the
> cache rows — bodies and cache stay in the I4 identity.

- **Rename**: `rewrite_note { id, title }` — uniqueness check, then the put,
  the referrer-body rewrite, and the cache retarget in one write transaction.
- **Delete**: `delete_note { id }` is **refused** with `notebook/card-referenced`
  while any inbound link exists; the refusal lists referrers (`title` + `id`).
  No cascade, no tombstones: an agent that wants the deletion gone rewrites the
  referrers first. This keeps I3 true by construction — a dangling link can never
  come into existence through delete either.
- **Dangling**: impossible in stored state (write-time refusal + delete guard).
  The only transient window is a failed multi-card rewrite, covered by the
  per-owner write serialization (§3.6 note).

### 3.5 Backlinks are derived; the `links` table is a disposable cache (D5)

- Source of truth: bodies. `backlinks(owner, title) ≡ { cards whose body parses
  to a link targeting title }` — this identity is invariant I4 and is tested as a
  property.
- Implementation: a second table `links` in the same domain, rows
  `{ owner, sourceId, targetTitle }` (keyed `${owner}/${sourceId}/${hash(targetTitle)}`),
  rewritten for one source card on each of its writes. Reads use the cache; the
  property test holds cache and scan equal on random graphs, renames, and
  deletions.
- Because the cache is disposable derived data, the draft proposed
  `invalidRecords: 'backup-and-skip'` for it. **Erratum (implementation):**
  that option is declared at the domain level and only takes effect under the
  per-record layout (see §3.6), so the links cache rides the rejecting default
  — a corrupt cache row fails the open loudly, which is the posture this
  codebase prefers anyway.

### 3.6 Storage domain: no medium migration (D6, as implemented)

> **Erratum (implementation, 2026-11-02).** The draft specified a version
> bump 1→2 with `compatibleVersions: [1]`. The harness mechanics turned out
> otherwise: the single-layout whole-unit format rejects any stored version
> other than the declared one (`storage-json/src/format.ts` —
> `compatibleVersions` is honored only on per-record record stamps), and the
> per-record layout requires path-safe record keys (`[a-zA-Z0-9_-]+`) —
> which the owner-embedding key `encodeURIComponent(owner)/<id>` can never
> promise, because that key IS the privacy contract. The implemented domain
> therefore stays **version 1, single layout**, extended in place:

```ts
defineDomain({
  name: 'notebook',
  version: 1,                    // unchanged — v1 media open natively
  global: { schema: globalSchema, initial: { linksSyncedAt: 0 } },
  tables: {
    notes: domainTable(noteSchema),  // schema untouched — v1 rows are valid cards
    links: domainTable(linksSchema), // new, disposable derived cache
  },
})
```

- **Migration contract**: there is none, in the strongest sense — opening a
  2.x medium under 3.0.0 accepts it as-is (same version, same parser, same
  schema). The `links` table starts empty and the `linksSyncedAt` global
  marker (0 on any pre-3 medium) triggers the one-time cache rebuild from
  bodies on the first 3.0.0 open; later opens skip it. **No row is
  transformed, dropped, or rewritten at open.**
- Concurrency note: title-uniqueness is check-then-put, but every mutation
  already runs through the domain's single per-domain write chain (and the
  service's own FIFO chain on top), so two concurrent
  `write_note { title: X }` calls cannot both pass the check — verified by the
  concurrent test in `tests/service.spec.ts`.

## 4. DSH adaptation — the primary writer is an agent (D7)

Luhmann's method assumes one human over a lifetime. Three of its load-bearing
habits do not survive that assumption and are re-derived here:

| Luhmann's habit | why it fails for agents | what replaces it |
|---|---|---|
| Folgezettel numbering (`21,3a7`) | encodes *physical* placement for a paper archive (C5/C6: findability was the hard problem) | titles as addresses (D2) + derived hubs/backlinks (D5); the store is queryable, paper is not |
| daily processing of fleeting into permanent notes | a human's review rhythm; sessions are short-lived | **write-time discipline**: resolution refusal + tool descriptions demand one-idea cards at the moment of writing — the discipline moves from review-time to write-time |
| human association to find links | the human's pattern-matcher | the model's: `list_backlinks`/`list_hubs` hand the model the neighborhood; the first screen delivers it on page open (D9) |

Kept verbatim: **one box per preset** (owner = preset id, structural isolation,
never a parameter); atomic cards; dense linking; hub cards; the box as a
communication partner (C4 — realized as the backlink/hub face, the box's "alter
ego" half).

Dropped: nothing else. In particular the design does **not** introduce
cross-preset boxes, shared graphs, or a "global knowledge base" — those would
break the ownership invariant the package's privacy story is built on.

**Day in the life** (the scenario the contract must let happen):

> Session A (Mon): the 研究员 preset debugs a storage failure and writes card
> 「存储域迁移必须不丢行」 with the lesson, linking `[[compatibleVersions 语义]]`
> (already a card). Session B (Thu, new session, no memory of A): the same preset
> opens `/apps/notebook/list`; the first screen lists recent cards and hubs; it
> opens the migration card's detail page; the first screen shows its backlinks —
> including Session A's lesson with an excerpt; the agent reads both cards and
> answers the user's question *from the box*, citing both ids.

Every step of that scenario runs through named tools and pages defined in §5–§6;
the 3080 checklist (§10c) walks it literally.

## 5. Tool face (D8)

| tool | status | notes |
|------|--------|-------|
| `notebook__list_notes` | keep | unchanged params; unchanged output shape |
| `notebook__read_note` | keep | unchanged |
| `notebook__write_note` | keep, tightened | new refusals `notebook/title-conflict`, `notebook/link-unresolved`; description now states: one card = one idea, title = complete phrase = address, link freely |
| `notebook__rewrite_note` | keep, tightened | same two new refusals + rename semantics (§3.4); `expectedUpdatedAt` guard unchanged |
| `notebook__delete_note` | keep, tightened | new refusal `notebook/card-referenced` listing referrers |
| `notebook__list_backlinks` | **new** | param `id`; returns `{ backlinks: [{ sourceId, sourceTitle, excerpt }] }`; the conversation-partner op (C4) |
| `notebook__list_hubs` | **new** | no params; top-10 by inbound count, `{ hubs: [{ id, title, inboundCount }] }`; the entry-point op (C5) |

- No other tool is added. `search_cards` is rejected (D10); merge/split
  primitives are rejected (D12 — the agent composes them from `rewrite_note`).
- No new skill is introduced; the method discipline lives in the tool
  descriptions, where the model already looks (subtraction: no second prose
  surface to keep in sync).
- Error codes added to the `RemoteErrorDetailsMap`:
  `notebook/title-conflict`, `notebook/link-unresolved`, `notebook/card-referenced`.
  **Union widening is a compile break for exhaustive switches over
  `NotebookErrorCode`** — recorded as part of the MAJOR justification (D11).

**Caller break list** (the complete behavioral diff for existing callers):
models may now be refused where they previously succeeded (duplicate title,
dangling link, delete of a referenced card). No tool is renamed, removed, or
re-parameterized; no output shape changes; `NoteView`/`NoteSummary` are
unchanged; notebook-ui compiles without modification except for any exhaustive
switch over the widened code union.

## 6. Page face (D9)

Both pages keep their URLs, archetypes, unattended levels, and the §6 delivery
face (`task_take/complete/fail`) exactly as built. The change is confined to the
first-screen messages (the `agent.followup` texts), which gain three sections:

- **list page**: after the note rows, a `hubs:` block (top cards by inbound
  links) — the re-entry orientation of C4/C5: a fresh session sees the box's
  structure before it reads any single card.
- **note detail page**: after the body, `links:` (this card's outbound links,
  with each target's id so the agent can open or read) and `backlinks:` (who
  points here, title + excerpt) — the box talking back at open time.
- Hubs/backlinks render as plain `- title（id）` lines; no new PAGE-block
  grammar, no PAGE-PATCH, no host-side change. The pages stay L1/L2 exactly as
  declared today; `serves/evidence/escape` texts gain one sentence about the new
  refusals, so the unattended audit trail stays truthful.

## 7. Anti-goals (D10)

This package is **not**:

1. a task list — the task-center owns tasks; card ≠ task;
2. a full-text search engine — no search tool; at box scale (target ≤ 10k cards,
   C5's boxes were 90k on paper) `list_notes` + links + hubs find things;
3. a human wiki — notebook-ui stays a thin panel; no rich rendering of bodies;
4. a cross-preset knowledge base — owner isolation is the privacy invariant (I8),
   sharing is out of scope forever;
5. a markdown renderer — bodies are plain text; the only structured syntax is
   `[[…]]`.

## 8. Invariants and test sketches

All specs go in the package-level `tests/` directory, `*.spec.ts` under vitest,
concurrent-safe (the "passes only when run alone" rule makes it a defect).

| id | invariant | test sketch |
|----|-----------|-------------|
| I1 | a card is cold-readable (atomic + self-contained) | **not unit-testable by construction** — adjudicated by the blind-read test (§10b); unit tests only enforce the addressable form: non-empty trimmed title, ≤ limits (existing `cleanTitle`/`cleanBody`) |
| I2 | title unique per owner | `write_note` twice with title X → second refused `title-conflict`; concurrent pair (Promise.all) → exactly one succeeds (per-owner serialization); rename onto an existing title refused |
| I3 | no dangling link is ever stored | write with `[[missing]]` refused `link-unresolved` with suggestions; `\[[missing]]` stored literally and parses to zero links; `[[1,2],[3,4]]` stored as literal text |
| I4 | backlinks ≡ body scan | property test: random card graphs (10–200 cards, random links/renames/deletes); after every op, `backlinksOf(X)` equals a fresh full scan of owner bodies for `[[X.title]]`; cache and scan must agree |
| I5 | rename preserves the graph | card A links `[[T]]`; rename T→T′; backlinks(T′) contains A; stored bodies unchanged (links address titles, bodies never rewritten by rename) |
| I6 | delete guards references | A links `[[T]]`; delete T refused `card-referenced` listing A; rewrite A to drop the link; delete T now succeeds |
| I7 | v1→v2 migration loses nothing | fixture of v1 rows opened under the v2 domain: row count and field equality preserved; `links` empty; first write after open rebuilds the cache; a row deliberately corrupt → open rejects (notes table keeps the default) |
| I8 | owner isolation | owner B cannot resolve A's titles; same title in A and B coexists; keys compose per owner (existing `noteKey` property, kept green) |
| I9 | reverse-order cleanup / HMR safety | registry-contribution test: dispose of the app tears down pages → tools → definition in reverse; re-register works; no leak across reloads (the check every registry contributor in this repo owes) |
| I10 | durability | write card + link → reopen domain → both intact (existing storage-domain promise, re-asserted over the v2 shape) |

Composition: a real-Loader test via `packages/test-support/loader-smoke` — the
family loads as a bundle in an isolated temp home; the app registers; a page
session's tool list contains `notebook__list_backlinks` and
`notebook__list_hubs`.

## 9. Package structure and version plane (D11)

- **Evolve `@veren/notebook` in place.** The card box is the same responsibility
  (the private notebook domain), not a second one — the ~20-file/domain split
  rule does not trigger: new sources are `links.ts` (parser), `graph.ts` (cache
  maintenance + queries), plus touched `types/notes/storage/tools`; the family
  stays at 4 packages. A separate `@veren/zettelkasten` package is rejected:
  it would either fork the storage domain (two notebooks) or force a dual-track
  note/card world — this repo's binding feedback forbids dual-track compat.
- New file budget (as implemented): core gains `links.ts` (parser),
  `graph.ts` (cache + queries), `validate.ts` (write-time rules),
  `cards.ts` (write paths), `tools-graph.ts` (the two builders), and
  `store.ts` (the storage lifecycle extracted so `index.ts` stays under the
  cap); `notebook-app` gains `first-screen.ts` the same way. Every file stays
  under the 300-line cap.
- **Version: MAJOR `3.0.0`, released through `-rc.N` on the staging environment
  (3100) before the test node (3080) tracks it.** Justification: (a)
  `NotebookErrorCode` union widens — a TypeScript break for exhaustive switches;
  (b) stored-data validity tightens — states that v2.2.1 accepted (duplicate
  titles, free-form bodies pointing anywhere) are refused from 3.0.0. Per the
  versioning convention (`docs/versioning.cn.md`), MAJOR = 契约/数据破坏, and
  MAJOR must pass `-rc.N` in staging. The family bumps as one line
  (notebook / notebook-app / notebook-ui / notebook-bundle → 3.0.0-rc.1), commit
  `chore(release): 3.0.0-rc.1 - notebook card box`, tag `v3.0.0-rc.1`.
- Gate checklist for the release: `pnpm check` green; `check:plugins` (peer+dev
  only — no new dependencies are introduced at all); `check:entries` (`exports`
  subpaths present in the packed form); `engines.dsh` unchanged
  (`>=0.2.1-rc.2 <0.3.0`); market index entry updated only with the version bump
  already in hand.

## 10. External adjudication — what besides us decides this is right

a. **Invariants green**: I1–I10 as sketched in §8, including the I4 property
   test and the I7 migration fixture. No human eyeballs involved.
b. **The blind-read test** (the atomicity adjudicator): sample 10 cards at
   random from a populated box (or the seeded 3080 data), present each to a
   *fresh* model with no page context, ask "what is this card about, and does it
   reference anything you cannot see?" — every card must be explainable on its
   own. This is C1's external verdict; a card that fails is a content defect,
   not a code defect, and the failure rate is reported, not hidden.
c. **Real-machine checklist (3080, human-legible)**:
   1. upgrade path: existing notes visible and intact after install;
   2. write card linking an existing card → success;
   3. write card linking a missing title → refused with suggestions;
   4. rename the target → referrer bodies are rewritten to the new title and backlinks follow;
   5. delete the target while referenced → refused listing the referrer;
   6. `list_backlinks` / `list_hubs` return truthful sections;
   7. restart the harness → cards and links intact (I10 on real storage);
   8. uninstall the bundle → clean teardown, no orphan registrations.
d. **Gates**: `pnpm check`, `check:plugins`, `check:entries`, version rules
   (no skipped numbers, bump before publish) — mechanical, run by the release.

## 11. Licensing red lines

- Reference implementations consulted for **design only**: Logseq, Joplin,
  SiYuan, Trilium, Zettlr (all AGPL/GPL) — **no code ported, no derivation**;
- Foam (MIT) may be consulted for data-model shape if needed, with attribution
  in the implementation PR;
- The parser and graph code are written from this document's contract, not from
  any upstream implementation.

## 12. Implementation order (the follow-up task, after review)

1. **P1 — core contract**: `links.ts`, `graph.ts`, storage v2 + migration
   fixture, tightened validations, per-owner write serialization, I2–I10 specs.
2. **P2 — tool & page face**: two new builders, tightened descriptions, first-screen
   sections, unattended meta audit, loader-smoke composition test.
3. **P3 — notebook-ui ack**: backlink count in the list, backlinks/links sections
   in the detail view; locales for the new strings (zh + en).
4. **P4 — release train**: `3.0.0-rc.1` → staging 3100 acceptance → 3080 tracks →
   §10c checklist → `3.0.0` final + market index bump.

---

## Appendix A — sources

- Luhmann, N. (1981). *Kommunikation mit Zettelkästen. Ein Erfahrungsbericht.*
  English translation: <https://zettelkasten.de/communications-with-zettelkastens/>
- Matuschak, A. *Evergreen notes should be atomic.*
  <https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic>
- Matuschak, A. *Evergreen notes should be densely linked.*
  <https://notes.andymatuschak.org/Evergreen_notes_should_be_densely_linked>
- Matuschak, A. *Prefer note titles with complete phrases.*
  <https://notes.andymatuschak.org/Prefer_note_titles_with_complete_phrases> (cited by title; fetch unstable)
- Schmidt, J. interview: *The Money Is on the Hubs* (sic, site title). Numbers
  quoted: ZK I 24,000 cards + 1,800 bibliographic entries; ZK II 66,000 + 16,000.
  <https://zettelkasten.de/posts/zettelkasten-hubs/>
- Niklas-Luhmann-Archiv (Bielefeld) — scanned originals, Folgezettel ids:
  <https://niklas-luhmann-archiv.de>
- Doto, B. *Tensions Between Zettelkasten & the Productivity Scene.*
  <https://writing.bobdoto.computer/tensions-between-zettelkasten-and-the-productivity-scene>
- Ahrens, S. *How to Take Smart Notes* — secondary literature only, flagged per C7.
- Harness storage-domain machinery: `deepseek/deepseek-harness/packages/storage/storage-domain/src/spec.ts`
  (`compatibleVersions`, `invalidRecords`, layout semantics).

## Appendix B — environment notes

- The `pnpm cli` tool is currently broken (harness `FiberState` export drift,
  `apps/cli/src/profile-boot.ts:16`). The wheel check this design required was
  performed by reading `package.json` files directly instead — documented here
  as the sanctioned bypass; fixing the cli is its own task and out of scope.
- All verification runs against the stable node `deepseek\.dsh` (port 3080),
  staging on 3100 for the rc, per `docs/environments.cn.md`; every `dsh` command
  carries an explicit `DSH_HOME`.
