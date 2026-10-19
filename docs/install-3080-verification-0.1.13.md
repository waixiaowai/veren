# 3080 最终升级到 0.1.13（节点卡片描边对比度）：成功

- 时间：2026-10-18T11:24:44.571Z
- 旧 PID：24668
- 当前 PID：40916
- 版本：panel **0.1.13**、echo **0.1.5**、graph runtime **0.1.2**、bundle **0.1.2**
- 启动方式：`dsh web --port 3080 --no-open`（`DSH_HOME=C:\Users\imeep\.dsh_test_2`，profile=web）
- 授权夹具：`veren-flow-approval-e2e@0.1.2`（保留）

## 失败原因

ok

## 最终验收

普通画布验收退出码：0；授权验收退出码：0。

- 侧栏「流程画布」；列表中文可读名。
- 节点卡片：左侧 3px 状态色条、类型图标、标题、状态词、副标题。
- 描边对比度：浅色计算值 `1px rgba(0, 0, 0, 0.16)`；暗色 `1px rgba(255, 255, 255, 0.2)`；两种主题截图边框均清楚可见。
- 运行 → 等待授权：顶部授权坞、状态条「1 个节点等待授权 / 流程已暂停」、选中 gate 自动开详情。
- 同意 → 「已同意，节点已完成」；拒绝 → `NODE_PERMISSION_DENIED`；超时 → `NODE_APPROVAL_TIMEOUT`。
- 刷新恢复、缩放/适应屏幕、点节点看 output 均通过。
- 论坛、记事本、启动项仍在侧栏；启动日志无失败。

## 截图

`dist-tgz/flow-canvas/3080-013-docs`：

- `shot-01-first-open.png`（浅色）
- `shot-11-dark.png`（深色）
- `shot-07-before-reload.png`
- `shot-08-after-reload.png`
- `shot-09-after-reload-settled.png`
- `shot-10-after-reload-output.png`

`dist-tgz/flow-canvas/3080-013-approval-docs`：

- `02-approval-card.png`
- `03-approved-complete.png`
- `05-denied.png`
- `06-timeout-card.png`
- `07-timeout-denied.png`
- `08-cancelled.png`

## 日志

- `C:\Users\imeep\.dsh_test_2\switch-3080-014.log`
- `C:\Users\imeep\.dsh_test_2\web-3080-after-014.log`
- `dist-tgz/flow-canvas/3080-013-docs/verify.log`
- `dist-tgz/flow-canvas/3080-013-approval-docs/verify.log`

## 回滚到 0.1.12

升级前备份：`package.json.bak-20261018-1922`、`pnpm-lock.yaml.bak-20261018-1922`、`pnpm-workspace.yaml.bak-20261018-1922`、`compatibility.json.bak-20261018-1922`。

1. 停止 3080，把上述备份复制回原名。
2. panel 改回 `deepseek-ai-dsh-graph-flow-canvas-panel-0.1.12.tgz`，echo 改回 `...node-echo-0.1.4.tgz`。
3. graph runtime 0.1.2 与 fixture 保持不变；`pnpm --dir C:\Users\imeep\.dsh_test_2\profiles\web install`。
4. 冷启动 3080。
