# @veren/mail-bundle

作为一个可安装 profile 层的通知技术栈：一个纯配置组合包按依赖顺序组装三个 `@veren` 插件。

## 挂载什么

| 行 | 包 | 带来什么 |
| --- | --- | --- |
| `mail` | @veren/mail | 通知领域：宿主存储域里的持久化工作流、收件人、分组、偏好与执行链；trigger → dispatch → deliver 链路；站内收件箱（`in_app`，常驻）；可选的 SMTP 邮件渠道；`mail` 远端命名空间 |
| `mail-tool` | @veren/mail-tool | 十二个面向模型的 `mail_*` 工具与内置的 `mail-notifications` 技能 |
| `mail-ui` | @veren/mail-ui | Web 面板：带可见状态操作的站内收件箱，与逐步骤的执行记录视图 |

行顺序有讲究，且由组合包自身的测试钉住：先核心（它提供服务），再工具（它们读取服务），最后
面板（它注入挂载好的命名空间）。inject 解析不到的行保持 pending——在插件页与启动日志里响亮
可见，绝不会悄悄半激活。

## 安装

从市场安装，或对本地 profile：

```bash
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add plugins/mail/bundle
```

然后在 profile 的插件页启用它，并重启宿主。

### 打开邮件渠道

站内收件箱零配置即可用。要同时发真实邮件，给 `mail` 行配一个 `smtp` 块（host、port、secure、
from，可选 user/password）——见 `cordis.patch.yml` 里的示例。除非接受明文落盘，否则不要把
密码写进 profile 配置；干脆不配 SMTP 块也完全可以。

## 验收

- 服务：`mail` 行显示 enabled 且无 pending inject；启动日志里没有它的 `waiting for inject` 行。
- 工具：问一个智能体它有哪些工具——`mail_*` 家族应出现。
- 技能：会话的技能目录里列出 `mail-notifications`。
- 面板：侧栏出现通知入口；收件箱能打开（未发过东西时为空）。
- 端到端：建一个收件人与一条单步工作流，然后触发一次，观察收件箱与执行记录页签。

## 开发

```bash
pnpm --dir plugins/mail/bundle test    # 清单 + patch 形状测试
```
