# market — plugin market index-source workspace

[中文](README.cn.md) | English

This directory does one job: turn this repository's plugin bundles into the `index.json` that DSH's **Discover** page
browses, and publish it to `https://market.veren.top/index.json`. For the format, the hosting setup, and
troubleshooting, see [docs/plugin-market-source.md](../docs/plugin-market-source.md).

```bash
pnpm market:build    # generate and validate market/site/index.json
pnpm market:deploy   # sync to /var/www/market on the 138 server and verify over HTTPS
node market/release.mjs --dry-run   # inspect the publish order
```

| File | Responsibility |
| --- | --- |
| `sources.txt` | Bundles to list, in index order |
| `market.json` | Market title, category and label declarations, and per-plugin localized title/description, category, labels and keywords |
| `build.mjs` | Generate with the DSH generator, merge market metadata, validate, write the output |
| `release.mjs` | Publish the dependency closure to npm.veren.top |
| `deploy.mjs` | Deploy and verify |
| `lib/` | Four small modules: paths, generator, metadata, validate |
| `deploy/nginx/` | The nginx site files for this domain |

`site/` and `.plugin-market-cache/` are generated and stay out of version control.
