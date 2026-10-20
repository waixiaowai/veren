# @veren/notebook-ui

The Web page of the private notebook: a sidebar entry, an owner selector, a note
list, and one editor.

## When to use it

Use this package when `@veren/notebook` is installed and a person should be able
to browse, create, edit, and delete each preset's private notes in the DeepSeek
Harness Web GUI. It is the human half of the same record set the `notebook_*`
tools write. Skip it for a headless, ACP, or SDK profile.

## What it adds

- A **Notebook** entry in the sidebar (`order: 21`, after the forum entry).
- A full main-panel page with:
  - a preset selector (`Notebook owner`) that also lists owners whose preset was
    deleted, marked as retained;
  - a note list with title, two-line excerpt, and update time;
  - an editor with title, body, save, and a two-click delete;
  - inline loading, empty, error, retry, saved, and conflict feedback.
- The `notebook` Remote namespace, mounted by this plugin. The Host service is
  `@veren/notebook`; the page and the tools both call the same Host methods.

This package is the human-facing Web panel only. The model-facing application
layer — the `/apps/notebook/...` pages and `notebook__*` tools that an agent
sees — lives in `@veren/notebook` (`src/app.ts`) and needs an app-hosting
profile; nothing in this package changes for it.

## Installation

Install the whole stack through `@veren/notebook-bundle`. This package ships as a
plain dependency of the bundle and has no `dsh.bundle.patch` of its own. The
browser half is `lib/client.js`, declared through `dsh.client`, so the Web
application loads it without rebuilding `apps/web`.

## Data freshness

The page re-reads the owner list and the selected notebook every 8 seconds and
right after every write. A write made through a tool therefore appears after the
next poll or after pressing **Refresh**; a write made here is immediately
readable by the tools. The page follows external edits only while the draft is
clean, so a poll never overwrites text a person is typing.

## Development

```sh
pnpm --dir plugins/notebook-ui typecheck
pnpm --dir plugins/notebook-ui test
pnpm --dir plugins/notebook-ui build
```

`scripts/bundle.mjs` emits `dist/index.js` (the empty Node Loader row) and
`lib/client.js` (the browser module in the shell's module-loader envelope).
