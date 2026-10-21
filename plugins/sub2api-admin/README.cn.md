# @veren/sub2api-admin

应用型 DSH 插件：注册「Sub2API 运营」应用——三个 GUI 页面（大盘 / 账号 / 用量）+ 六个面向模型的管理工具，页面与工具共用同一个 `Sub2AdminClient` 与同一份凭据配置。结构与 `@veren/task-workbench` 参考实现一致（`ctx.apps.register` → `apps.tools` → `apps.pages`，`defineAppPage` JSX 树 + 共享 store）。

## 页面

| 页面 | URL | 内容 | 数据来源 |
| --- | --- | --- | --- |
| dashboard（入口） | `/apps/sub2api-admin/dashboard` | 今日请求/token/费用/新用户、RPM/TPM、用户/账号/错误账号数、分组列表 | `GET /admin/dashboard/stats`、`/admin/groups/all` |
| accounts | `/apps/sub2api-admin/accounts` | 上游账号列表（前 50）：id/名称/平台/类型/状态/可调度 | `GET /admin/accounts` |
| usage | `/apps/sub2api-admin/usage` | 近 7 日趋势、模型维度统计、区间汇总 | `/admin/usage/stats`、`/admin/dashboard/{trend,models}` |

插件激活即拉一次真实数据；工具写入成功后自动刷新对应 store 切片，页面树经 SNAPSHOT/PATCH 同步进页面会话。

## 工具（应用目录本地名，对外名 `sub2api_admin__<name>`）

`overview`、`accounts`（15 个动作）、`usage`、`users`、`redeem_codes`、`request`（`/api/v1/admin/**` 直通）。动作→端点映射表驱动，定义见 `src/tools.ts`。

## 凭据

不硬编码。解析顺序：插件行 `config` → `SUB2API_*` 环境变量（`SUB2API_BASE_URL`、`SUB2API_ADMIN_API_KEY`、`SUB2API_JWT`、`SUB2API_EMAIL`、`SUB2API_PASSWORD`、`SUB2API_TIMEOUT_MS`）。认证优先级：API Key > JWT > 邮箱密码登录（401 自动重登）。

## 安装

安装组合包 `@veren/sub2api-admin-bundle`（唯一 profile 层），见该包 README。

## 开发

```powershell
pnpm --dir plugins\sub2api-admin typecheck   # tsc --noEmit（extends 工作区 tsconfig.base）
pnpm --dir plugins\sub2api-admin test        # vitest 单测（mock fetch）
```

## 已知限制

- accounts 页固定取前 50 条；更多用 `accounts` 工具分页查询。
- 文件流式导出（`accounts export`、CSV）未封装，用 `request` 工具。
- 页面树的 GUI 呈现依赖宿主页面会话管线；本包不写 client UI 插件。
