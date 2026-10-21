# @veren/sub2api-admin-bundle

配置型组合包：一步装好 Sub2API 运营工具集。patch 把 `@veren/sub2api-admin` 工具插件作为该技术栈唯一的 profile 层插入；成员插件以普通依赖随包安装、不自带 bundle 声明，因此安装组合包绝不会重复插行。

安装后，通过插件配置表单（Web 插件页）或启动 DSH 前的 `SUB2API_*` 环境变量设置凭据——本组合包内不落任何敏感信息。

## 安装

前置：`@veren/app-host-bundle`——应用框架，提供本技术栈硬注入的 `apps` 服务与 prompt 栈。

```powershell
# 先装应用框架（profile 里已有则跳过）。
pnpm dsh plugin --profile <profile> add @veren/app-host-bundle@0.2.6
# 再装本组合包；成员插件随包一起装上。
pnpm dsh plugin --profile <profile> add @veren/sub2api-admin-bundle@1.2.1
```

所有依赖都按语义化版本区间从 `@veren` registry 解析：打包后的清单把 `@veren/sub2api-admin` 声明为 `^1.2.1`，任何产物都不引用本地 `file:` 路径。

## 已知限制

- patch 中行配置保持为空；凭据必须来自环境变量或插件配置表单。
- 未先安装应用框架层时，该行会等待 `apps` 注入而不激活。
