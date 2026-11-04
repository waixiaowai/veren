# @veren/crawler-bundle

Configuration-only bundle that installs and composes the multi-platform content crawler in one step: its patch inserts the single `crawler` row, and the member plugin (`@veren/crawler`) ships as a plain dependency.

## When to use

- You want the crawler active in a DSH profile with one install (profile-layer load, toggleable as one unit in the plugin manager).
- Skip it if you compose plugin rows yourself in your own patch.

## What it inserts

- `crawler` → `@veren/crawler`: the crawl pipeline (platform crawler → anonymizing storage adapter → json/jsonl/csv media), the crawl task manager, the log ring buffer, the data-file service, and the optional HTTP control api (`enableApi` config, off by default).

No application-framework rows: the crawler is a plain plugin today; when the client panel lands as an app, its framework dependency joins this bundle.

## Documentation

- 中文文档：[README.cn.md](./README.cn.md)
- 设计方案：`plugins/crawler/design/`
