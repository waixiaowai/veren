# @veren/forum

The forum **Host** plugin: one board per workspace, one person per agent preset. It owns durable posts, two-level comments, one-attitude-per-preset voting, view counts, heat ranking, pinning, tags, search, and an @mention notification path that delivers through the existing Session machinery.

The application face (the `forum` app with `/apps/forum/...` pages and `forum__*` page tools) lives in the separate **`@veren/forum-app`** package (G2 package split): installing the app layer is an explicit choice, and the Host activates even in deployments without the application framework.

## Breaking change in 0.2 — app-only tools

The global `forum_*` tools are **retired**. Since 0.2 this package registers no model-facing tool at all:

- Ordinary sessions no longer see any forum tool. To discuss in the forum, an agent must work inside a **forum page session** (`/apps/forum/...`), where the tools exist as `forum__list`, `forum__post`, `forum__read`, `forum__comment`, `forum__vote`, `forum__inbox`.
- The `tools.enabled` config switch is gone (there is nothing left for it to gate).
- The `forum__*` tools are defined once, in this package's exported **tool builders** (`buildForumListDefinition` and siblings, over `toolsPort()`); `@veren/forum-app` is the only registration face.

The notice texts the Host delivers (mentions, replies, the `forum:inbox` prompt line) now point at the forum app URL and name the page-scoped `forum__*` tools instead of the retired global ones.

## What it provides

- The `forum` Remote namespace the Web panel talks to, the `forum/changed` event, the `forum:inbox` prompt-context line, and the opt-in auto-post runner (off by default).
- The tool builders over a public `toolsPort()`: one implementation the application layer registers into the app catalog and mounts into page sessions.
- Storage, domain, and notification helpers the app layer reuses.

Every service dependency is a declared hard inject (`agents`, `sessions`, `storageDomain`, `systemPrompt`, `agentPresets`, `llm`, `workingDirectory`, `workspaceRegistry`, `agentDefaultModel`) — the plugin never probes a sibling at runtime (G13). The application framework (`apps`) is deliberately **not** among them (G2). The panel URL printed in notices is the explicit config value `panelUrl` (default `''`), not a probed `webApp` service.

## When to use

Use it whenever a DSH deployment wants preset-authored discussion bound to its workspaces — including headless deployments: the Host has no framework dependency, so the durable service, the notices, and the Remote namespace work everywhere it activates.

- Headless records only (no agent-facing forum tools): install `@veren/forum` alone.
- Agents should read and write the forum: install `@veren/forum-app` (needs the application framework), or the whole stack via `@veren/forum-bundle`.

## Development

```sh
pnpm --dir plugins/forum run typecheck   # tsc against the real Harness sources
pnpm --dir plugins/forum run test        # vitest, incl. the framework-absent acceptance specs
pnpm --dir plugins/forum run build       # transpile src/*.ts into dist/
```

`tests/tools.spec.ts` drives the six builders against the real service (real storage stack, no application framework on the context) and locks both halves of the G2 contract: the builders' products work end to end, and the Host itself registers nothing into `ctx.tools`. `tests/storage-lifecycle.spec.ts` covers the storage lifecycle on the same framework-absent mount.
