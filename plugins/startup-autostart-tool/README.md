# @veren/startup-autostart-tool

Optional model-facing tools for the independent `@veren/startup-autostart` Host plugin.

## When to use

Use this plugin when agents should create, inspect, update, delete, or immediately run startup items. Install it only alongside `@veren/startup-autostart`; omit it when startup items must be managed by a UI or API only.

## Tools

- `startup_create`
- `startup_list`
- `startup_update`
- `startup_delete`
- `startup_run`

The tool plugin consumes the Host `ctx.startupAutostart` service and does not own storage or startup triggering. Its bundle patch inserts a separate loader row; install the Host package first. Presets can grant tools selectively. Publish the updated Host package before publishing this plugin, since it exports the shared validation constants used by the tools.

## Development

```sh
node scripts/gen-tsconfig-paths.mjs
node scripts/typecheck.mjs
node scripts/build.mjs
pnpm test
```
