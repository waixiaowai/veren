# @veren/sub2api-admin

应用型 DSH 插件：注册「Sub2API 运营」应用——九个 GUI 页面（首页 / 渠道 / 分组 / 用户 / 订阅 / 资金 / 卡密 / 账号 / 用量）+ 十一个面向模型的管理工具，页面与工具共用同一个 `Sub2AdminClient` 与同一份凭据配置。结构与 `@veren/task-workbench` 参考实现一致（`ctx.apps.register` → `apps.tools` → `apps.pages`，组件页（`PageFC` + `useSnapshot`）+ 共享 store）。

## 页面

| 页面 | URL | 内容 | 挂载工具 |
| --- | --- | --- | --- |
| home（入口） | `/apps/sub2api-admin/home` | 运营指挥台：收入/成本/毛利/活跃/新增/今日请求+tokens、待处理订单、异常/限流/过载账号、待办路由 + AI 操作指引 | `overview` |
| channels | `/apps/sub2api-admin/channels` | 上游渠道列表；开通 / 编辑 / 下架 | `channels`、`request`（渠道测活/监控） |
| groups | `/apps/sub2api-admin/groups` | 分组列表（倍率 / 平台 / 订阅类型 / 限额）；创建 / 编辑 / 删除、模型倍率批量设置 | `groups` |
| users | `/apps/sub2api-admin/users` | 用户列表（余额 / 分组 / 状态）；开通、充值 / 扣减、封禁、换组 | `users` |
| subscriptions | `/apps/sub2api-admin/subscriptions` | 订阅列表；分配 / 续期 / 重置额度 / 撤销 / 恢复 | `subscriptions` |
| finance | `/apps/sub2api-admin/finance` | 支付订单（前 20）+ 订阅套餐 + 收入汇总 | `payment`、`overview` |
| codes | `/apps/sub2api-admin/codes` | 兑换码（生成 / 核销 / 过期 / 删除）+ 优惠码（创建 / 编辑 / 删除 / 用例）+ 兑换统计 | `redeem_codes`、`promo_codes` |
| accounts | `/apps/sub2api-admin/accounts` | 上游账号列表（平台 / 类型 / 状态 / 可调度）；状态 / 调度 / 清错 / 配额 / 批量运维 | `accounts` |
| usage | `/apps/sub2api-admin/usage` | 近 7 日趋势、模型维度统计、区间汇总 | `usage` |

插件激活即拉一次真实数据；工具写入成功后自动刷新对应 store 切片，页面树经 SNAPSHOT/PATCH 同步进页面会话。每页 `instructions` 点名的工具与该页实际挂载严格一致（承诺=挂载），listPage 正文「配套工具」行列出全部挂载工具外名。

## 工具（应用目录本地名，对外名 `sub2api_admin__<name>`）

`overview`、`channels`、`groups`、`users`、`subscriptions`、`payment`、`promo_codes`、`redeem_codes`、`accounts`（15 个动作）、`usage`、`request`（`/api/v1/admin/**` 直通）。动作→端点映射表驱动，定义见 `src/tools.ts`。

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
