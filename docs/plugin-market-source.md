# DSH plugin market index source

English | [中文](plugin-market-source.cn.md)

**Audience**: developers who publish this project's plugins, and operators who host the index.

**Prerequisites**: DSH profiles and bundles (`dsh.bundle.patch`), pnpm workspaces, and an nginx static site.

## What an index source is

DSH's **Plugins → Discover** page carries no plugin data of its own. It stores a list of **index source URLs**, and the
DSH Host fetches each one into an `index.json` that it filters, sorts, and pages locally. Developing an index source
therefore means serving one **format 1** JSON document from a stable HTTPS address and keeping it current as releases
ship.

The format is defined and validated by `@deepseek-ai/dsh-plugin-market-index`:

| Field | Meaning |
| --- | --- |
| `format` | Always `1`; any other value rejects the whole index |
| `title` / `description` | Market name and summary as `LocalizedText` (a string, or an object that contains `en`) |
| `metadata.categories` / `labels` / `sortKeys` | Market-defined declarations; Discover reads their titles and never interprets the ids |
| `plugins[]` | One entry per plugin; `name` is an npm package name, unique within the index |
| `plugins[].versions[]` | Exact version, publish timestamp, source (npm or a Git commit), and `engines.dsh` for each installable version |

Two constraints decide what can appear:

- Only packages that declare `dsh.bundle.patch` are listed, because the market installs profile bundles.
- A client installs the **exact version pinned in the index** (or Git commit), never `name@latest`. An index that is
  not regenerated never shows a new release.

## This project's index source

| Item | Value |
| --- | --- |
| Index URL | `https://market.veren.top/index.json` |
| Hosting | nginx static directory `/var/www/market` on the 138 server (`43.240.223.138`) |
| Certificate | Let's Encrypt for `market.veren.top`, certbot webroot mode, auto-renewed |
| Site configuration | `market/deploy/nginx/market-veren-http.conf` and `market-veren-https.conf` |
| Package source | `npm.veren.top` (verdaccio), so every version records `source.registry` |

The site is **anonymous and read-only** on purpose: Discover fetches it from the DSH Host without user credentials, so
no login gate may sit in front of it.

## Repository layout

```text
market/
  sources.txt            Bundles to list, one npm package name per line; the order is the index order
  market.json            Market title/description, category and label declarations, per-plugin category/labels/keywords
  build.mjs              Generate: run the DSH generator → merge market metadata → validate → write site/index.json
  release.mjs            Publish the dependency closure in topological order, skipping versions the registry has
  deploy.mjs             Sync site/ to the 138 server and verify over HTTPS
  lib/                   Four small modules: paths, generator, metadata, validate
  deploy/nginx/          The two nginx site files used by this domain
  site/                  Generated output (not committed); this is what gets deployed
```

`build.mjs` reuses the DSH checkout's generator (`apps/plugin-market-generator`) and validator
(`packages/util/plugin-market-index`); this repository does not restate the format rules.

## Workflow

### 1. Release

After changing plugins and passing `pnpm check:plugins`:

```bash
pnpm -r --filter "./plugins/**" build   # packages that ship dist/ or lib/client.js must be built first
node market/release.mjs --dry-run       # inspect the order and the versions that will be skipped
node market/release.mjs                 # publish to npm.veren.top
```

`release.mjs` starts from `sources.txt`, closes over workspace `dependencies`, publishes dependencies first, and skips a
`name@version` the registry already has, so re-running is safe. It never bumps versions: raise them yourself before a
release.

### 2. Build the index

```bash
pnpm market:build
```

The output is `market/site/index.json`, plus `site/icons/` when an icon is too large to inline. The generator reads the
registry packument, downloads the tarball of the highest version for display fields, and derives compatibility from
`engines.dsh` (falling back to `@deepseek-ai/dsh-*` peer ranges).

### 3. Deploy

```bash
node market/deploy.mjs --dry-run   # print the commands only
pnpm market:deploy                 # upload and self-check for HTTP 200
```

### 4. Add it in Discover

Open **Plugins → Discover** and add `https://market.veren.top/index.json`. That entry is user configuration
(`pluginMarket.indexes`, a volatile field): do not put it in the repository or in a profile's `cordis.yml`. Reload the
page with Ctrl+R afterwards.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Discover reports the source as invalid | `curl -s https://market.veren.top/index.json \| head`; then read the `plugin-market/invalid-index` JSON path in the DSH log |
| A package is missing from the list | Does the published version declare `dsh.bundle.patch`? Does it have a publish time? Is `engines.dsh` a valid range? |
| Install refuses the version as incompatible | Installation re-evaluates `engines.dsh` against the running DSH runtime; the index must copy the manifest range unchanged |
| An icon does not load | A relative `icon` resolves against the index URL and must stay under `https://market.veren.top/`, or be a `data:` URL |
| An old index keeps showing | The site sends `no-store` for `index.json`; otherwise look for an intermediate proxy cache |

## Security boundaries

- Indexes are unsigned. Titles, authors, and an `official` label are the market's claims, not DSH verification.
- An index can point any name at any registry. Confirm each entry's source before installing; Discover's confirmation
  shows the index URL and the source.
- This domain serves static files only: no scripts, no credentials. The certificate key stays in `/etc/letsencrypt` on
  the 138 server.
