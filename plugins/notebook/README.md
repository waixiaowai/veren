# @veren/notebook

One private, durable notebook per agent preset: a pure domain service served to
people through the `notebook` Remote namespace and to models through exported
tool builders that a mounter registers.

## When to use it

Use this package when presets should be able to keep private notes that follow
the preset rather than the workspace, and a person should be able to open the
same notes in the Web GUI. Do not use it for shared notes, team notes, or notes
attached to a project. This package registers no tools itself; if models should
reach the notebook at all, install **`@veren/notebook-app`** (or mount the
exported builders from your own host code).

## Breaking change in 0.2.0

The global `notebook_*` tools are **retired**. Ordinary sessions no longer see
any notebook tool; the five tools now live only inside notebook page sessions
as `notebook__*`, mounted by `@veren/notebook-app` — so a preset uses its
notebook by opening `/apps/notebook/list` (the list page) and works from
there. This is a 0.x breaking change by design: one capability, one
registration face, one place to look.

## Ownership and isolation

The owner of a note is always the preset id of the Agent that wrote it. The
tool builders have no owner parameter: `src/tools.ts` resolves the owner from
the live Agent on every call. The storage key is composed as
`encodeURIComponent(owner) + "/" + noteId`, so a preset that passes another
preset's note id composes a key under its own owner and reaches no row. The Web
page does let a person choose whose notebook to read; that is the point of the
page, not a tool capability.

A note is not attached to a workspace. The same preset keeps one notebook in
every workspace and in every session.

## Tool builders

The package exports one builder per notebook operation
(`buildNotebookListDefinition`, `buildNotebookReadDefinition`,
`buildNotebookWriteDefinition`, `buildNotebookRewriteDefinition`,
`buildNotebookDeleteDefinition`). Each returns a `defineTool` product scoped to
its caller at execution time; nothing registers here. A mounter defines the
products into an app catalog and mounts them into page sessions, where the
registry composes the external `notebook__<local>` names.

| Builder | Tool (local) | Purpose |
| --- | --- | --- |
| `buildNotebookListDefinition` | `list_notes` | List the calling preset's notes, newest update first. |
| `buildNotebookReadDefinition` | `read_note` | Read one note's whole body. |
| `buildNotebookWriteDefinition` | `write_note` | Write a note (title required, body may be empty). |
| `buildNotebookRewriteDefinition` | `rewrite_note` | Replace the title, the body, or both. |
| `buildNotebookDeleteDefinition` | `delete_note` | Delete one note permanently. |

`rewrite_note` accepts an optional `expectedUpdatedAt`. When supplied and the
note has moved on, the tool refuses with `notebook/conflict` instead of
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
| Note list (entry) | `/apps/notebook/list` | `notebook__list_notes`, `notebook__write_note` |
| Note detail | `/apps/notebook/note/:noteId` | `notebook__read_note`, `notebook__rewrite_note`, `notebook__delete_note` |

Registration is single-entry: `notebook-app`'s `src/app.ts` calls
`ctx.apps.register`, `ctx.apps.tools(id).define`, and
`ctx.apps.pages(id).register` only; the page registrar mirrors into the page
registry internally, so the app is never visible in the catalog without also
being resolvable by URL. Registration runs inside one `ctx.effect` whose body
rolls finished steps back in reverse when a later one fails (no half-wiring),
and the whole layer tears down in reverse order when the plugin unloads.

## Storage

The plugin opens one storage domain named `notebook` with one table, `notes`.
With the JSON backend the file is `$DSH_HOME/storages/notebook.json`; with SQLite
it is the same domain in the profile database. Notes survive a Harness restart,
a browser refresh, and deleting a project directory.

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
