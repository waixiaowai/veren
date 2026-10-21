# @veren/app-host-ui

The Web half of the Veren application toolbar. It adds an **application dropdown to the chat input toolbar** (`conversation.input.left`): the dropdown lists every installed application from the host's `appHost` gateway, and selecting one opens the app's **entry page** into a fresh page session and follows the host's `app-host/focus` event to switch the GUI to that session. It is the GUI half of the focus port — skip it for headless, ACP, or SDK profiles, where the `app_list` / `app_open` model tools already cover the operations.

## Use when / 何时使用

- The `@veren/app-host` assembly (with `@veren/app-host-bundle`) is loaded in the profile, and people open application pages (task workbench, notebook, forum, person agent) from the chat UI.
- Skip it when the profile has no app-host assembly: the dropdown would show "catalog read failure" and nothing else.

## How it works / 工作方式

- **Data channel**: the browser half hand-builds a Typert Remote contribution (`createTypertRemoteInfo`) over the host's `appHost` gateway service (`appHost/catalog`, `appHost/open`) and mounts it with `ctx.remote.$mount`; the host's `app-host/focus` emit event arrives through the same Remote carrier.
- **Focus**: on `app-host/focus`, the plugin calls `ctx.uiWorkspace.openSession(sessionId)` — the actual GUI switch. The host never touches the DOM.
- **Failure states are explicit**: catalog read failure (with the stable error code + retry), empty catalog, missing entry page, disabled/broken apps, and entry-open failures all render as readable rows/notes — never a silent blank.
- Page sessions activate their agent at open (the host side's job), so a page session appears in the session list under its instance title (`发布任务`, `主题 #12`, …) and can be entered like any other session.

## Layout / 结构

- `src/client/remote.ts` – the hand-built Remote contribution + focus event redeclaration.
- `src/client/catalog.ts` – the catalog HostObservable (`loading/ready/failed`).
- `src/client/picker.tsx` – the dropdown component (pure props, no `ctx`).
- `src/client/index.tsx` – mounts the namespace, registers into the slot, performs the focus switch.
- `scripts/bundle.mjs` – emits `dist/index.js` (Node row) and `lib/client.js` (browser module).

中文说明见 [README.cn.md](README.cn.md)。
