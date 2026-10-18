# 3080 升级到 0.1.11（新 UI + 授权坞）：成功

- 时间：2026-10-18T06:17:50.222Z
- 旧 PID：51928
- 当前 PID：29476
- 版本：panel **0.1.11**、echo **0.1.3**、graph runtime **0.1.2**、bundle **0.1.2**
- 启动方式：`dsh web --port 3080 --no-open`（`DSH_HOME=C:\Users\imeep\.dsh_test_2`，profile=web）
- 授权夹具：`veren-flow-approval-e2e@0.1.2`（保留；安全 echo 工具，无文件/命令副作用）

## 失败原因

ok

## 验收结果

普通画布验收退出码：0；授权验收退出码：0。

- 侧栏入口为「流程画布」；首次打开无需刷新，列表显示中文可读名（演示流程 / 授权演示·明确要求 等）。
- 新 UI：图从左到右横向布局（start → gate → after 同一 y）；右下角有缩放、100% 重置与「适应屏幕」。
- 选中节点自动打开右侧「节点详情」；`approval-explicit` 挂起时详情随授权节点自动打开。
- 状态条突出「1 个节点等待授权 / 流程已暂停」，顶部授权坞显示工具、原因、参数、截止时间与剩余秒数。
- `approval-explicit` 点「同意」：授权坞切换为「已同意，节点已完成」，工具执行、三节点完成。
- `approval-ambient` 点「拒绝」：`NODE_PERMISSION_DENIED`，节点失败、下游跳过。
- `approval-timeout`：5 秒后自动拒绝，`NODE_APPROVAL_TIMEOUT`。
- 取消运行：挂起请求撤销，节点「已取消」。
- 刷新恢复：同一 run 续上；点节点仍显示 `snapshot.result.nodes["gate"].output`。
- 3080 原有启动项、论坛、记事本仍在侧栏；启动日志无失败。

## 截图

普通画布（`dist-tgz/flow-canvas/3080-011-docs`）：

- `shot-01-first-open.png`
- `shot-07-before-reload.png`
- `shot-08-after-reload.png`
- `shot-09-after-reload-settled.png`
- `shot-10-after-reload-output.png`

授权（`dist-tgz/flow-canvas/3080-011-approval-docs`）：

- `02-approval-card.png`（顶部授权坞 + 等待授权 + 自动详情）
- `03-approved-complete.png`
- `05-denied.png`
- `06-timeout-card.png`
- `07-timeout-denied.png`
- `08-cancelled.png`

## 日志

- `C:\Users\imeep\.dsh_test_2\switch-3080-012.log`
- `C:\Users\imeep\.dsh_test_2\web-3080-after-012.log`
- `dist-tgz/flow-canvas/3080-011-docs/verify.log`
- `dist-tgz/flow-canvas/3080-011-approval-docs/verify.log`

## 回滚到 0.1.10

升级前备份：`package.json.bak-20261018-1414`、`pnpm-lock.yaml.bak-20261018-1414`、`pnpm-workspace.yaml.bak-20261018-1414`、`compatibility.json.bak-20261018-1414`。

1. 停止 3080，把上述备份复制回原名。
2. 把 profile 依赖的 `@deepseek-ai/dsh-graph-bundle` 改回 `file:../../packages/dsh-graph-bundle-0.1.1`，panel/echo 改回 0.1.10/0.1.2。
3. 把 per-package 依赖改回 0.1.1（或删除直接依赖，让 bundle 提供），移除 0.1.2 的 flat tarballs；保留 `veren-flow-approval-e2e`。
4. `pnpm --dir C:\Users\imeep\.dsh_test_2\profiles\web install`，冷启动 3080。
