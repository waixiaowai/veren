# DSH plugin version policy

English | [中文](dsh-plugin-versions.cn.md)

Every package under `plugins/` runs inside a DSH process it does not own. DSH is pre-stable, so a plugin built against one runtime release may use services, events, or record fields the next release changes. Two failures follow from that, and only one of them is loud.

- **A `dependencies` entry for a DSH package is not a version lock.** pnpm installs that copy into the profile, where it shadows the running installation. The plugin then holds a second `Context`, a second `Service` base class, and second copies of every registration table, while the host keeps its own. Cordis reports the symptom late and far from the cause: a service the plugin registered is invisible, a Remote namespace never resolves, or a tool disappears.
- **Without `engines.dsh`, no check runs at all.** DSH admits a plugin by reading its `engines.dsh`, or, when that is absent, its `@deepseek-ai/dsh*` peer ranges. A manifest with neither imposes no constraint, so an incompatible plugin loads and fails at runtime instead of being refused with an actionable message.

## The rule

| Declaration | Holds |
| --- | --- |
| `engines.dsh` | The single version contract: `>=0.2.1-rc.2 <0.3.0`. DSH refuses to load or install the package outside it. |
| `peerDependencies` | Every package whose instance must be shared with the host: `@deepseek-ai/cordis` and each `@deepseek-ai/dsh-*` imported for a value. Ranges use the same window as `engines.dsh`. |
| `devDependencies` | The same packages at the exact verified runtime version, plus type-only imports and test tooling. These copies serve the compiler and unit tests and are never installed into a profile. |
| `dependencies` | Third-party packages, `@veren/*` packages, `@deepseek-ai/schemastery` (the sanctioned runtime validator), and stateless DSH utilities (`dsh-brand`, `dsh-util-values`, `dsh-util-crypto`). No other DSH package belongs here. |

The profile template sets `autoInstallPeers: false`, so peer ranges are never installed into a profile. At load time the plugin's own directory has no copy, the profile has none, and the runtime resolution supplies the installation's package — one instance for both sides. `@deepseek-ai/schemastery` stays a real dependency because it is a validator, not a stateful service; two copies agree through the Standard Schema contract.

`engines.dsh` takes precedence over peer ranges. Declare both with the same window so the peer list documents the shared capabilities without contradicting the version contract.

## The manifest shape

```json
{
  "engines": { "dsh": ">=0.2.1-rc.2 <0.3.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.5",
    "@deepseek-ai/dsh-tools": ">=0.2.1-rc.2 <0.3.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.5",
    "@deepseek-ai/dsh-tools": "0.2.1-rc.2"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.4"
  }
}
```

Use `import type` or `import type {}` for packages that contribute only types or declaration merging; those belong in `devDependencies` alone. A value import puts the package in `peerDependencies`.

## Enforcing it

`pnpm check:plugins` runs [`scripts/check-plugin-manifests.mjs`](../scripts/check-plugin-manifests.mjs) over every manifest in `plugins/` and `packages/`. It fails on a missing or widened `engines.dsh` in a plugin, a DSH package under `dependencies` anywhere, a peer without a dev mirror, or a dsh peer with a different range. Run it after adding a plugin and before publishing.

The `@deepseek-ai/dsh-graph-*` packages are ours, not DSH runtime packages, but DSH's compatibility check reads every `@deepseek-ai/dsh-*` peer range as a runtime requirement. They therefore declare `engines.dsh` as well, which takes precedence and stops DSH from judging their workspace peers.

## The workspace install layout

Correct declarations can still install twice. When one `@deepseek-ai/dsh-tools` lands at two physical paths — a user-global `node-linker=hoisted` puts a real directory at the root while each package's `node_modules` links into its own `.pnpm` entry — brand types such as `ToolExecutionToken` split: symbols are keyed by module path, two paths are two symbols, and same-named types stop being assignable while the error reads like an ordinary mismatch.

The project `.npmrc` therefore fixes three things: `node-linker=isolated` (one physical instance per package name), `auto-install-peers=false` (pnpm folds each importer's auto-filled peer set into the virtual-store hash, so one version splits into several entries), and `shamefully-hoist=true` (packages already in the tree are promoted to the root `node_modules` as **links**, so legacy phantom imports keep resolving while the physical copy stays unique).

The root `package.json` `devDependencies` therefore also act as the dev-tree stand-in for the host: packages that `import` their own peers at run time — `dsh-tools`, `dsh-app-boot` — need real copies of `dsh-sandbox`, `dsh-home-paths`, and the rest. Declaring them at the root keeps them out of every plugin's peer combination and only puts them in the root `node_modules` for Node to find upward.

`scripts/check-dsh-instances.mjs` checks the resolution result, not the declarations: one host-shared name resolving to several physical paths or several versions fails, and it names the packages and ranges involved. A declaration check cannot see this, which is why it stands on its own.

## Upgrading to a new DSH release

1. Point `DSH_CHECKOUT` at the harness checkout for the target release; the generated `tsconfig.paths.json` files and the build scripts follow it.
2. Run the plugin's build, unit tests, and its real-Loader composition test against that checkout.
3. When they pass, move the floor of `engines.dsh` and of every dsh peer, then set the matching exact versions in `devDependencies`. Keep the `<0.3.0` ceiling until the runtime leaves pre-stable.
4. Run `pnpm check:plugins`, rebuild, and reinstall into a test node.

The profile-level escape hatch, `dsh plugin allow-version <package@version> --dsh-version <runtime> --accept-risk`, records an exact-version exemption in that profile's `compatibility.json`. Treat it as a diagnostic for an already-broken node, never as the upgrade path: it grants one package version on one runtime version and inherits nothing.

## Proving one instance

A passing load proves only that imports resolved. A composition test should also assert identity: import the service package from the plugin and check that the host's object satisfies it, for example that `ctx.get('storage')` is an instance of the `Storage` class the plugin imported, and that `ctx.constructor` is the `Context` the plugin imported. Equal version strings from different directories do not share module state.

## Known limits

- The browser build consumes the shell's frozen module table from the workspace package [`packages/platform-modules/platform-modules.mjs`](../packages/platform-modules/platform-modules.mjs) (zero build; the declaration in `platform-modules.d.mts` is a literal tuple). `pnpm check:platform-modules` compares it item by item with `packages/client/web/src/platform.ts` under `DSH_CHECKOUT` and fails on a missing, extra, duplicated, or reordered module, so a baseline change no longer relies on manual review.
- `pnpm check:plugins` validates declarations, not behavior. Only the composition test covers a runtime that changed a service contract without changing its version.
