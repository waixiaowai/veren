# 3080 升级到 0.1.10 / 授权节点：成功

- 时间：2026-10-18T03:33:15.714Z
- 旧 PID：26020
- 当前 PID：25320
- 版本：panel **0.1.10**、echo **0.1.2**、graph runtime **0.1.1**（含 flow-approval 0.1.1）
- 启动方式：`dsh web --port 3080 --no-open`（`DSH_HOME=C:\Users\imeep\.dsh_test_2`，profile=web）
- 授权夹具：`veren-flow-approval-e2e@0.1.2`（E2E-only，安全 echo 工具，无文件/命令副作用）

## 失败原因

ok

## 验收结果

普通画布验收退出码：0；授权验收退出码：0。

- 首次打开侧栏「Flow 画布」即出现 flow 列表。
- `canvas-demo-pacing` 运行中状态实时推进，整页刷新后同一 run 续上。
- `approval-explicit`：节点进入「等待授权」，卡片显示工具/原因/参数/期限；点「同意」后工具执行、三个节点完成。
- `approval-ambient`：tools 管线 ask 触发同一卡片；点「拒绝」后 `NODE_PERMISSION_DENIED`，下游跳过。
- `approval-timeout`：5 秒后自动拒绝，`NODE_APPROVAL_TIMEOUT`。
- 取消运行：挂起请求被撤销，节点 `已取消`。
- 3080 原有启动项、论坛、记事本仍在侧栏，启动日志无失败。

## 截图

- `dist-tgz/flow-canvas/3080-docs/shot-01-first-open.png`
- `dist-tgz/flow-canvas/3080-docs/shot-08-after-reload.png`
- `dist-tgz/flow-canvas/3080-approval-docs/02-approval-card.png`
- `dist-tgz/flow-canvas/3080-approval-docs/03-approved-complete.png`
- `dist-tgz/flow-canvas/3080-approval-docs/05-denied.png`
- `dist-tgz/flow-canvas/3080-approval-docs/06-timeout-card.png`
- `dist-tgz/flow-canvas/3080-approval-docs/07-timeout-denied.png`
- `dist-tgz/flow-canvas/3080-approval-docs/08-cancelled.png`

## 日志

- `C:\Users\imeep\.dsh_test_2\switch-3080-011.log`
- `C:\Users\imeep\.dsh_test_2\web-3080-after-011.log`
- `dist-tgz/flow-canvas/3080-docs/verify.log`
- `dist-tgz/flow-canvas/3080-approval-docs/verify.log`

## 回滚到 0.1.9

备份（升级前）：`package.json.bak-20261018-1122`、`pnpm-lock.yaml.bak-20261018-1122`、`pnpm-workspace.yaml.bak-20261018-1122`、`compatibility.json.bak-20261018-1122`。

1. 停止 3080，把上述备份复制回原名。
2. 把 `dist-tgz/flow-canvas/graph-bundle-0.1.9` 覆盖到 `C:\Users\imeep\.dsh_test_2\packages\dsh-graph-bundle`（这是升级前不含 flow-approval 的 bundle）。
3. 把 `dist-tgz/flow-canvas/deepseek-ai-dsh-graph-flow-canvas-panel-0.1.9.tgz` 和 `...node-echo-0.1.1.tgz` 装回；移除 panel 0.1.10/echo 0.1.2、`dsh-graph-bundle-0.1.1`、`veren-flow-approval-e2e`。
4. `pnpm --dir C:\Users\imeep\.dsh_test_2\profiles\web install`，再冷启动 3080。
