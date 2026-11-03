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
  - a **card canvas** (the default face): the box's cards placed on rings by kind
    and link count, with curved relation edges, edge-hover neighborhood
    highlighting, card dragging, wheel zoom, and an intake strip for fleeting
    cards;
  - a list face (the narrow-viewport fallback and the accessible equivalent);
  - a preset selector (`Notebook owner`) that also lists owners whose preset was
    deleted, marked as retained;
  - a note list with title, two-line excerpt, update time, and each row's inbound-link badge (`⟲ n`);
  - an editor with title, body, save, and a two-click delete;
  - the selected card's link sections — outgoing and backlinks — fetched on
    selection change, each direction with its honest empty state;
  - inline loading, empty, error, retry, saved, and conflict feedback.
- The `notebook` Remote namespace, mounted by this plugin. The Host service is
  `@veren/notebook`; the page and the tools both call the same Host methods.

This package is the human-facing Web panel only. The model-facing application
layer — the `/apps/notebook/...` pages and `notebook__*` tools that an agent
sees — lives in `@veren/notebook` (`src/app.ts`) and needs an app-hosting
profile; nothing in this package changes for it.

## Canvas rendering

The canvas is not a board of absolutely-positioned DOM cards: the card atlas is
painted on one Konva stage (a Canvas2D scene graph), and each relation is a single
Bézier path that carries both the 1.6px ink and the 12px hit stroke. A canvas has
no CSS inheritance, so `canvas-theme.ts` resolves the `--nb-*` aliases through a
hidden in-page probe (including `color-mix`) and rebuilds the palette when
`body[data-ds-dark-theme]` changes. Dragged positions are view state only and
live in localStorage per owner; a card's data is never touched.

Why: absolutely-positioned DOM cards make every card a DOM box with wrapping,
shadows and transitions inside one transformed world, so every drag frame
re-lays out the subtree and style resolution becomes the ceiling. Konva brings
hit testing, drag thresholds, text wrapping, and stage pan/zoom as scene-graph
primitives. The full spec and trade-offs are in
`docs/notebook-canvas-interaction.cn.md` §7.

`konva` is a build-time dependency: it is bundled into `lib/client.js`, so an
installed profile does not pull a second copy at runtime.

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
