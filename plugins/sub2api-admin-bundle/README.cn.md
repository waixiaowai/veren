# @veren/sub2api-admin-bundle

配置型组合包：一步装好 Sub2API 运营工具集。patch 把 `@veren/sub2api-admin` 工具插件作为该技术栈唯一的 profile 层插入；成员插件以普通依赖随包安装、不自带 bundle 声明，因此安装组合包绝不会重复插行。

安装后，通过插件配置表单（Web 插件页）或启动 DSH 前的 `SUB2API_*` 环境变量设置凭据——本组合包内不落任何敏感信息。

## 安装（本地 tarball，稳定测试节点）

```powershell
mkdir dist-tgz -Force
pnpm --dir plugins\sub2api-admin pack --pack-destination dist-tgz
pnpm --dir plugins\sub2api-admin-bundle pack --pack-destination dist-tgz
node plugins\sub2api-admin-bundle\scripts\repack.mjs dist-tgz
$env:DSH_HOME = 'C:\Users\imeep\Documents\cursour\deepseek\.dsh'
pnpm --dir deepseek\deepseek-harness dsh plugin --profile web add <cursour>\dist-tgz\veren-sub2api-admin-bundle-1.0.0.tgz
```

## 已知限制

- patch 中行配置保持为空；凭据必须来自环境变量或插件配置表单。
