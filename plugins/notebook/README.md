# @veren/notebook

One private, durable card box per agent preset — the Zettelkasten contract on
the notebook domain (design: [docs/notebook-zettelkasten-design.cn.md](../../docs/notebook-zettelkasten-design.cn.md)):
cards are atomic, the title is the card's link address, bodies carry `[[title]]`
links, and the derived `links` cache answers the backlink/hub queries — the box
talking back. Served to people through the `notebook` Remote namespace and to
models through exported tool builders that a mounter registers.

## When to use it

Use this package when presets should be able to keep private cards that follow
the preset rather than the workspace, link them into a knowledge network, and a
person should be able to open the same box in the Web GUI. Do not use it for
shared notes, team notes, notes attached to a project, a task list, or a
full-text search engine. This package registers no tools itself; if models
should reach the box at all, install **`@veren/notebook-app`** (or mount the
exported builders from your own host code).

## Breaking change in 0.2.0

The global `notebook_*` tools are **retired**. Ordinary sessions no longer see
any notebook tool; the five tools now live only inside notebook page sessions
as `notebook__*`, mounted by `@veren/notebook-app` — so a preset uses its
notebook by opening `/apps/notebook/list` (the list page) and works from
there. This is a 0.x breaking change by design: one capability, one
registration face, one place to look.

**Since 3.0.0 the global face is back, behind a switch**: `globalTools.enabled`
(on by default) mounts the four consult/write tools (`notebook__list_notes`,
`notebook__find_cards`, `notebook__read_note`, `notebook__write_note`) into
**every session of the preset** — the box as the always-available second
memory. Page sessions shadow the globals with same-name agent-scope
registrations (the registry's documented semantics), so every capability keeps
exactly one name. `rewrite_note` and `delete_note` remain page-only (deletion
is the L2 contract). Flip the switch off and the box goes back to
page-only.

## Ownership and isolation

The owner of a card is always the preset id of the Agent that wrote it. The
tool builders have no owner parameter: `src/tools.ts` resolves the owner from
the live Agent on every call. The storage key is composed as
`encodeURIComponent(owner) + "/" + cardId`, so a preset that passes another
preset's card id composes a key under its own owner and reaches no row. The Web
page does let a person choose whose box to read; that is the point of the page,
not a tool capability.

A card is not attached to a workspace. The same preset keeps one box in every
workspace and in every session.

## Cards, titles, and links

- **The title is the link address.** Titles are unique per owner
  (`notebook/title-conflict` on a clash) and every `[[title]]` occurrence in a
  body must resolve to an existing card of the same owner when the card is
  written (`notebook/link-unresolved` with the closest existing titles
  otherwise). A dangling link is never stored.
- **Renaming follows.** A rename rewrites every referring body and retargets
  the cache rows, so `[[old title]]` never dangles; the referrers' update
  times move with the rewrite.
- **Deleting is guarded.** `delete_note` is refused with
  `notebook/card-referenced` (naming the referrers) while any card still links
  to the target.
- **Escapes and code.** `[[1,2],[3,4]]` stays literal (the inner span carries
  brackets); a literal double bracket is written `\[[like this]]`.
- **Backlinks are derived, never stored as truth.** The `links` table is a
  disposable cache maintained by every write; the property test in
  `tests/cards.spec.ts` holds it equal to a fresh body scan across random
  op histories.

## Tool builders

The package exports one builder per operation — the five CRUD builders plus
the box's two talking-back builders
(`buildNotebookBacklinksDefinition`, `buildNotebookHubsDefinition`). Each
returns a `defineTool` product scoped to its caller at execution time; nothing
registers here. A mounter defines the products into an app catalog and mounts
them into page sessions, where the registry composes the external
`notebook__<local>` names.

| Builder | Tool (local) | Purpose |
| --- | --- | --- |
| `buildNotebookListDefinition` | `list_notes` | List the calling preset's cards, newest update first. |
| `buildNotebookFindDefinition` | `find_cards` | Find cards by a title fragment (exact contains, 20-row cap) — a pre-write duplicate check and an address lookup are the same cheap query. |
| `buildNotebookReadDefinition` | `read_note` | Read one card's whole body. |
| `buildNotebookWriteDefinition` | `write_note` | Write a card (unique title required; `[[title]]` links must resolve). |
| `buildNotebookRewriteDefinition` | `rewrite_note` | Replace the title, the body, or both; a rename retargets inbound links. |
| `buildNotebookDeleteDefinition` | `delete_note` | Delete one card permanently; refused while referenced. |
| `buildNotebookBacklinksDefinition` | `list_backlinks` | The cards that link to one card. |
| `buildNotebookHubsDefinition` | `list_hubs` | The box's entry points, ranked by inbound links. |

`rewrite_note` accepts an optional `expectedUpdatedAt`. When supplied and the
card has moved on, the tool refuses with `notebook/conflict` instead of
overwriting a newer edit.

## The notebook application: the only registration face

The application face (the `notebook` app with `/apps/notebook/...` pages and
the `notebook__*` page tools) lives in the separate **`@veren/notebook-app`**
package (G2 package split), and it is the only face that registers anything.
This host declares no application-framework inject at all (G2): it activates
even in headless deployments where the framework is absent, and
`tests/app.spec.ts` locks that contract (activation with no `apps` service
present, nothing registered into any tools registry, and no inject/wait
warning). Installing `@veren/notebook-app` is what turns the notebook into an
app; that package hard-injects the framework and the `notebook` service.

| Page | URL | Page tools |
| --- | --- | --- |
| Card list (entry) | `/apps/notebook/list` | `notebook__list_notes`, `notebook__write_note`, `notebook__list_hubs` |
| Card detail | `/apps/notebook/note/:noteId` | `notebook__read_note`, `notebook__rewrite_note`, `notebook__delete_note`, `notebook__list_backlinks` |

Registration is single-entry: `notebook-app`'s `src/app.ts` calls
`ctx.apps.register`, `ctx.apps.tools(id).define`, and
`ctx.apps.pages(id).register` only; the page registrar mirrors into the page
registry internally, so the app is never visible in the catalog without also
being resolvable by URL. Registration runs inside one `ctx.effect` whose body
rolls finished steps back in reverse when a later one fails (no half-wiring),
and the whole layer tears down in reverse order when the plugin unloads.

## Storage

The plugin opens one storage domain named `notebook` (version 1, unchanged from
2.x — a 2.x medium opens natively, no migration runs) with the `notes` table,
the derived `links` cache table, and a `linksSyncedAt` global marker that
triggers the one-time links rebuild from bodies on the first 3.0.0 open. With
the JSON backend the file is `$DSH_HOME/storages/notebook.json`; with SQLite it
is the same domain in the profile database. Cards survive a Harness restart, a
browser refresh, and deleting a project directory.

If the domain cannot open, the service records the failure and every operation
reports `notebook/storage-unavailable`; the rest of the Harness keeps running.

## Known boundaries

- **A preset is deleted.** Its notes are kept, not dropped. The Web page lists
  the owner as `preset removed; notes retained`, and a person can still read or
  delete those notes. A preset id that is declared again sees the same notebook.
- **A note is too long.** Title limit: 200 characters. Body limit: 100,000
  characters. The Host refuses with `notebook/body-too-long` and names the actual
  length; the page shows a live counter.
- **A blank note.** A title is required. A body may be empty. Whitespace-only
  titles are refused with `notebook/title-required`.
- **Both sides edit at once.** The page sends `expectedUpdatedAt`; a stale save is
  refused with `notebook/conflict` and the page keeps the draft. Tools use the
  same optional guard; without it, the last write wins.
- **A link points nowhere.** The write is refused with `notebook/link-unresolved`
  and the closest existing titles; write the target card first, or escape a
  literal with `\[[`.
- **A title collides.** Titles are addresses: the write is refused with
  `notebook/title-conflict` naming the card that holds the title.
- **Deleting a referenced card.** Refused with `notebook/card-referenced`
  naming the referrers; remove those links first.
- **Storage cannot open.** Reads and writes fail with a stable code; the page
  shows the failure and a retry button.

## Development

```sh
pnpm --dir plugins/notebook typecheck
pnpm --dir plugins/notebook test
pnpm --dir plugins/notebook build
```

The package is built outside the Harness workspace: `scripts/build.mjs`
transpiles each source file with the checkout's TypeScript, and type checking
runs against the checkout's sources through `tsconfig.paths.json`.

## Verification

See [docs/notebook-verification.md](../../docs/notebook-verification.md) for the
non-engineer click-through and the known boundaries.
