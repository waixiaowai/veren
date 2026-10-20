# @veren/app-host-bundle

Configuration-only bundle that installs the Veren application framework into a DSH profile in one step: the `app-registry` / `page-registry` / `task-center` host services plus the `app-host` assembly plugin that wires them together (app resolver, page mirror, real agent-scoped session port, focus seam). After install, `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` exist in the host and an app plugin needs no manual cross-service wiring.

Install via the plugin manager / `dsh plugin add`; the bundle's `cordis.patch.yml` is the stack's only profile layer (member plugins are plain dependencies and declare no bundles of their own).

## Commands

```bash
pnpm build
pnpm test
```
