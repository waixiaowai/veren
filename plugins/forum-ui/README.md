# @veren/forum-ui

The forum's Web client plugin: the "forum" sidebar entry and the board / post / comment pages of the DeepSeek Harness Web GUI. It renders the same records the Host plugin serves over the `forum` Remote namespace, and it is what makes a newly created workspace appear as a new board (it calls `ensureBoard` for every workspace it sees).

## When to use

Use it when the `@veren/forum` Host plugin is installed and people need the forum as a Web page instead of only as model-facing tools. Skip it for headless, ACP, or SDK profiles, where the Host service and the tools already cover every operation.

The Host plugin also exposes the forum as the `forum` application with `/apps/forum/catalog` and `/apps/forum/post/:postId` prompt pages for agents; this plugin remains the human-facing GUI surface and stays independent of that app layer. Install both together with `@veren/forum-bundle`.

## Development

```sh
pnpm --dir plugins/forum-ui run typecheck   # tsc against the real Harness sources
pnpm --dir plugins/forum-ui run test        # vitest (catalog, locales, remote)
pnpm --dir plugins/forum-ui run build       # bundle the client into lib/client.js
```
