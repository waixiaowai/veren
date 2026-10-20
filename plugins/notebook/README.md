# @veren/notebook

One private, durable notebook per agent preset, exposed to the preset as
`notebook_*` tools and to a person through the `notebook` Web page.

## When to use it

Use this package when presets should be able to keep private notes that follow
the preset rather than the workspace, and a person should be able to open the
same notes in the Web GUI. Do not use it for shared notes, team notes, or notes
attached to a project.

## Ownership and isolation

The owner of a note is always the preset id of the Agent that wrote it. The
model-facing tools have no owner parameter: `src/tools.ts` resolves the
owner from the live Agent on every call. The storage key is composed as
`encodeURIComponent(owner) + "/" + noteId`, so a preset that passes another
preset's note id composes a key under its own owner and reaches no row. The Web
page does let a person choose whose notebook to read; that is the point of the
page, not a tool capability.

A note is not attached to a workspace. The same preset keeps one notebook in
every workspace and in every session.

## Model-facing tools

| Tool | Purpose |
| --- | --- |
| `notebook_list` | List the calling preset's notes, newest update first. |
| `notebook_read` | Read one note's whole body. |
| `notebook_create` | Write a note (title required, body may be empty). |
| `notebook_update` | Replace the title, the body, or both. |
| `notebook_delete` | Delete one note permanently. |

`notebook_update` accepts an optional `expectedUpdatedAt`. When supplied and the
note has moved on, the Host refuses with `notebook/conflict` instead of
overwriting a newer edit.

## The notebook application

Where a host mounts the application registry (`ctx.apps`, that is, an
app-hosting profile), the plugin also registers the `notebook` application:
an entry list page and a note detail page under `/apps/notebook/...`, with
page-scoped tools that carry the `notebook__` prefix. The layer degrades to a
logged warning where no app registry exists; the global tools above keep
working either way.

| Page | URL | Page tools |
| --- | --- | --- |
| Note list (entry) | `/apps/notebook/list` | `notebook__list_notes`, `notebook__write_note` |
| Note detail | `/apps/notebook/note/:noteId` | `notebook__read_note`, `notebook__rewrite_note`, `notebook__delete_note` |

Registration is single-entry: `src/app.ts` calls `ctx.apps.register`,
`ctx.apps.tools(id).define`, and `ctx.apps.pages(id).register` only; the page
registrar mirrors into the page registry internally, so the app is never
visible in the catalog without also being resolvable by URL. The whole layer
tears down in reverse order when the plugin unloads. Sourcing the app requires
`@veren/app-registry`, `@veren/page-registry`, and `@veren/prompt-page` as
peers; profiles without them simply skip the layer.

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
