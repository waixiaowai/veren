# @veren/zhihu-ops-bundle

Installs the Zhihu operations-analysis application in one step.

This is a **configuration-only bundle**: it carries no runtime code, and its
patch inserts exactly one row — the `zhihu-ops` application. Everything the
application does (the daily read-only pull, the durable snapshots, the derived
metrics, the four pages, and the report delivery) lives inside that one app.

The application framework — the app registry, the page registry, the task
center, and app-host — rides in through the `@veren/app-host-bundle`
dependency, which inserts its own framework rows.

## Why one profile layer

The member plugin does **not** declare `dsh.bundle.patch`. That is what keeps
the stack at a single profile layer: `dsh plugin` reconciliation can only
activate this bundle, so installing it can never double-insert a row. The
member ships as a plain dependency and rides along.

## Install

```bash
dsh plugin --profile web add @veren/zhihu-ops-bundle
```

Then open the Zhihu operations application and call `setup_credentials` with
the Access Secret you created at [developer.zhihu.com](https://developer.zhihu.com).

## What it needs

- A Zhihu open-platform **Access Secret** (the only credential; it lands in the
  credential store, never in configuration).
- The application framework (`@veren/app-host-bundle`), which this bundle
  depends on.

## What it does not do

It never publishes, comments, or follows on Zhihu. It only reads, and it only
writes to the local storage domain and the task center.
