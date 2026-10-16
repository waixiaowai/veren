# @veren/startup-autostart-ui

The **Web panel** for startup items: a sidebar entry named after the plugin and
a global page that lists, edits, runs, and deletes the items stored by
[`@veren/startup-autostart`](../startup-autostart/README.md).

Use it when people should see and change startup items themselves. Skip it on a
headless, ACP, or SDK profile — there is no browser to render it, and the Host
service plus `@veren/startup-autostart-tool` already cover every operation.

## What it is

One Loader row with a browser half. The Node half is empty; it exists so the Web
application can discover the browser module (the client module system scans
active Loader rows for a `dsh.client` manifest).

Install it independently of the Host service and of the tool plugin:

```sh
plugin_manager  install_bundle  target = @veren/startup-autostart-ui@1.4.0
```

Then reload the page. Removing the bundle removes the sidebar entry and the
page; stored items are untouched.

## Using the page

The sidebar entry sits beside the shipped "Automated tasks" page.

- **List** — name, an enable switch (writes immediately), the action, a target
  summary, the last result with its time, and the run count. Search matches the
  name, the message, and the session id; the filter selects all, enabled, or
  disabled.
- **Detail** — every stored field. Name, enable, action, target, and message are
  editable; saving sends only the fields that actually changed, so an edit made
  elsewhere survives. The pane also shows what it cannot edit: id, model,
  created and updated instants, last run, last result, and run count.
- **Run once now** — delivers the item immediately instead of waiting for the
  next start.
- **Delete** — asks for confirmation first, then removes the item.
- **New** — opens a session where the model registers the item with
  `startup_create`. The page has no form of its own, matching the automated-tasks
  page: creation keeps one implementation of the field rules instead of a second
  copy in the browser.

Copy is bilingual (English and Simplified Chinese) and resolves through the
Client locale service, so it follows the application language.

## How it reads and writes

The page talks to the Host through the `startup` Remote namespace
(`catalog` / `create` / `update` / `delete` / `run`) — the same endpoints the
model's `startup_*` tools use, so the page and the tools always act on one stored
record set.

That namespace is **not** generated for this package. Generated Remote
contributions come from `scripts/generate-typert.ts`, which only reads packages
inside the DeepSeek Harness checkout, and the browser's Remote assembly mounts a
fixed list of them. This package therefore builds the same contribution by hand
with `createTypertRemoteInfo` (the constructor the generated artifacts call) and
mounts it in its own `apply`. `src/client/remote.ts` is the single place that
mirrors the Host endpoints.

## Refreshing

Two things re-read the list: a replaced transport generation (a reconnect) and a
ten-second timer that runs while the page is mounted.

The Host does emit `startup-autostart/changed` after every durable write, but the
browser never receives it: the Web application forwards an explicit allowlist of
Host events (`packages/api/remotes/src/remote-events.ts`), and a package outside
that checkout cannot join it. The timer is the substitute, so an item created by
the model appears without user action. Making it event-driven needs one line in
that allowlist.

## Building

`veren cli build` classifies this package as a frontend plugin — it declares
`dsh.client` — and runs `npm run bundle`, which emits both halves:
`dist/index.js` (the empty Node row) and `lib/client.js` (the browser module).

```sh
pnpm cli build @veren/startup-autostart-ui
```

## Model Experience

None. The panel registers no model-facing tool, prompt, or message; it only reads
and writes records the Host service already owns. Nothing here enters a model
request, so it has no KV-cache effect.

## Known Limitations and Deferred Work

- Creation has no form: a new item starts in a session, as on the automated-tasks
  page.
- The list refreshes on a timer rather than on the Host's change event, because
  that event is not forwarded to packages outside the checkout.
- The panel styles itself from one injected stylesheet rather than CSS Modules,
  because this package builds outside the Client bundler where `*.module.css` is
  compiled. Colors come only from the shared `--dsw-*` tokens.
