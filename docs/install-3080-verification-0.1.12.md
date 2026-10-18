# 3080 升级到 0.1.12（节点卡片视觉 + 暗色）：成功

- 时间：2026-10-18T08:05:24.108Z
- 旧 PID：29476
- 当前 PID：24668
- 版本：panel **0.1.12**、echo **0.1.4**、graph runtime **0.1.2**、bundle **0.1.2**
- 启动方式：`dsh web --port 3080 --no-open`（`DSH_HOME=C:\Users\imeep\.dsh_test_2`，profile=web）
- 授权夹具：`veren-flow-approval-e2e@0.1.2`（保留）

## 失败原因

ok

## 验收结果

普通画布验收退出码：0；授权验收退出码：0。

- 侧栏「流程画布」正常；列表为中文可读名（演示流程 / 授权演示·明确要求 等）。
- 节点卡片新版：左侧状态色条（`data-node-rail` 实测 3px）、类型图标、标题、状态词、类型/错误副标题；实测默认工具卡 `gate` 的 `data-node-tone` 与 aria。
- 暗色适配：切到 `body[data-ds-dark-theme]` 后卡片背景从 `rgb(255,255,255)` 变为 `rgb(35,35,36)`，文字转为浅色；截图见 `shot-11-dark.png`。
- 运行 → 等待授权：顶部授权坞出现；状态条「1 个节点等待授权 / 流程已暂停」；选中 gate 自动开详情。
- 同意：授权坞显示「已同意，节点已完成」，工具执行并完成。
- 拒绝：`NODE_PERMISSION_DENIED`；超时：`NODE_APPROVAL_TIMEOUT`。
- 刷新恢复、缩放/适应屏幕、点节点看 output 均通过。
- 论坛、记事本、启动项仍在侧栏；启动日志无失败。

## 截图

普通画布（`dist-tgz/flow-canvas/3080-012-docs`）：

- `shot-01-first-open.png`
- `shot-11-dark.png`（暗色节点卡片）
- `shot-07-before-reload.png`
- `shot-08-after-reload.png`
- `shot-09-after-reload-settled.png`
- `shot-10-after-reload-output.png`

授权（`dist-tgz/flow-canvas/3080-012-approval-docs`）：

- `02-approval-card.png`
- `03-approved-complete.png`
- `05-denied.png`
- `06-timeout-card.png`
- `07-timeout-denied.png`
- `08-cancelled.png`

## 日志

- `C:\Users\imeep\.dsh_test_2\switch-3080-013.log`
- `C:\Users\imeep\.dsh_test_2\web-3080-after-013.log`
- `dist-tgz/flow-canvas/3080-012-docs/verify.log`
- `dist-tgz/flow-canvas/3080-012-approval-docs/verify.log`

## 回滚到 0.1.11

升级前备份：`package.json.bak-20261018-1602`、`pnpm-lock.yaml.bak-20261018-1602`、`pnpm-workspace.yaml.bak-20261018-1602`、`compatibility.json.bak-20261018-1602`。

1. 停止 3080，把上述备份复制回原名。
2. 把 panel 依赖改回 `deepseek-ai-dsh-graph-flow-canvas-panel-0.1.11.tgz`，echo 改回 `...node-echo-0.1.3.tgz`。
3. graph runtime 0.1.2 与 fixture 保持不变；`pnpm --dir C:\Users\imeep\.dsh_test_2\profiles\web install`。
4. 冷启动 3080。
