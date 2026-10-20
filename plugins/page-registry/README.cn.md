# Page Registry（页面注册表服务）

[English](./README.md) | 中文

## 是什么 / 何时用

宿主级 **Service 插件**，持有 LLM 页面会话的页面注册表——能力接缝中 `PageRegistryService` 契约的 Service Provider。页面插件需要把声明式页面（`{ name, url, description }`，URL 模式如 `/task-detail/:taskId`）注册进部署级唯一注册表、导航入口/目录/模型工具需要解析 URL（路径参数 + query，path 优先）时使用。没有声明式页面就不要装。

## 三角色

- **Service Definition**（`src/service.ts`）：`register`（返回 disposer，HMR/卸载安全）/ `resolve<S>(url)` / `get<S>(name)` / `catalog()` / `format(pattern, params)`
- **Service Provider**（默认导出）：部署顶层挂载一次；会话子作用域经 `inject: ['pageRegistry']` 解析到同一实例
- **Consumer**：页面插件（`registry.register(page)`）、导航工具（`registry.resolve(url)` → 关旧会话 + mount）、目录面板（`registry.catalog()`）

## 契约

- 重名 / URL 模式冲突在注册时抛错（misconfiguration fails loud）
- `resolve` 无命中返回 `null`；合并参数为 `{ ...query, ...pathParams }`（path 优先）
- 内核（`@veren/prompt-page`）保持 cordis 无关；本插件是注册表与宿主相接的唯一位置

## 运行

```bash
pnpm --filter @veren/page-registry test
```
