# market — 插件市场索引源工程 / Plugin market index-source workspace

中文 | [English](README.md)

这个目录只做一件事：把本仓库的插件 bundle 变成一份 DSH「发现」页能直接浏览的 `index.json`，并发布到
`https://market.veren.top/index.json`。原理、服务器与排错说明见
[docs/plugin-market-source.cn.md](../docs/plugin-market-source.cn.md)。

```bash
pnpm market:build    # 生成并校验 market/site/index.json
pnpm market:deploy   # 同步到 138 的 /var/www/market，并自检 HTTPS
node market/release.mjs --dry-run   # 查看发布顺序
```

| 文件 | 职责 / Responsibility |
| --- | --- |
| `sources.txt` | 要上架的 bundle 清单；顺序就是索引默认顺序 / Bundles to list, in index order |
| `market.json` | 市场标题、分类/标签声明、每个插件的中英展示标题/介绍、分类、标签与关键词 / Market metadata and per-plugin overrides |
| `build.mjs` | 调用 DSH 生成器、合并元数据、校验、写产物 / Generate, merge, validate, write |
| `release.mjs` | 按依赖闭包发布到 npm.veren.top / Publish the dependency closure |
| `deploy.mjs` | 部署与自检 / Deploy and verify |
| `lib/` | 路径、生成器调用、元数据合并、校验四个模块 / Four small modules |
| `deploy/nginx/` | 站点配置源文件 / The nginx site files for this domain |

产物 `site/` 与缓存 `.plugin-market-cache/` 不入库。
