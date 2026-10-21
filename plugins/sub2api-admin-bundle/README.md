# @veren/sub2api-admin-bundle

Configuration-only bundle that installs the Sub2API operations toolkit in one step: its patch inserts the `@veren/sub2api-admin` tool plugin as the stack's single profile layer. The member plugin ships as a plain dependency without a bundle declaration of its own, so installing this bundle can never double-insert the row.

After install, set the Sub2API credentials either in the plugin's config form (Web plugin page) or via `SUB2API_*` environment variables before launching DSH — nothing sensitive lives in this bundle.

## Install (local tarballs, stable test node)

```powershell
mkdir dist-tgz -Force
pnpm --dir plugins\sub2api-admin pack --pack-destination dist-tgz
pnpm --dir plugins\sub2api-admin-bundle pack --pack-destination dist-tgz
node plugins\sub2api-admin-bundle\scripts\repack.mjs dist-tgz
$env:DSH_HOME = 'C:\Users\imeep\Documents\cursour\deepseek\.dsh'
pnpm --dir deepseek\deepseek-harness dsh plugin --profile web add <curseur>\dist-tgz\veren-sub2api-admin-bundle-1.0.0.tgz
```

## 已知限制 / Known Limitations

- The row config stays empty in the patch; credentials must come from the environment or the plugin config form.
