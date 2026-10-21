# @veren/sub2api-admin-bundle

Configuration-only bundle that installs the Sub2API operations toolkit in one step: its patch inserts the `@veren/sub2api-admin` tool plugin as the stack's single profile layer. The member plugin ships as a plain dependency without a bundle declaration of its own, so installing this bundle can never double-insert the row.

After install, set the Sub2API credentials either in the plugin's config form (Web plugin page) or via `SUB2API_*` environment variables before launching DSH — nothing sensitive lives in this bundle.

## Install

Prerequisite: `@veren/app-host-bundle` — the application framework that provides the `apps` service and the prompt stack this stack hard-injects.

```powershell
# Application framework first (skip when the profile already carries it).
pnpm dsh plugin --profile <profile> add @veren/app-host-bundle@0.2.6
# Then this bundle; the member plugin comes with it.
pnpm dsh plugin --profile <profile> add @veren/sub2api-admin-bundle@1.2.1
```

Every dependency resolves from the `@veren` registry by version range: the packed bundle declares `@veren/sub2api-admin` as `^1.2.1`, and no artifact references a local `file:` path.

## 已知限制 / Known Limitations

- The row config stays empty in the patch; credentials must come from the environment or the plugin config form.
- Without the application framework layer installed first, the row waits on its `apps` inject instead of activating.
