# 证据清单（Phase 0 / Phase 5 共用协议）

## Phase 5 裁决记录（2026-11-03）

| 门禁 | 结果 |
| --- | --- |
| 改版后截图矩阵 | `after/`：overview 1440+700、source/trigger_all/eval/execution/settings 1440，共 7 张（与其余 before 格口径一致） |
| 选择器迁移无损 | 旧 client.css 350 个选择器在新四文件中 **350/350** 全对齐（comm 校验，另有 3 条初遗漏当场补回） |
| 对比度（程序化，页面实测） | 度量值 24px **18.9**、脉冲标题（改中性色）**18.9**、度量标签（升 secondary）**5.8**、muted 零值（24px 大字 + tertiary）**3.71 ≥ 3.0**——新词汇全绿；宿主 token 存量缺口（hint 3.71 / link 4.23 / caption 2.13）属宿主层，记录不修 |
| 5 秒盲测 | **通过**：零上下文 agent 只看改版截图，两问全对（"有事，2 个来源异常；点顶部横幅/异常条目处理"），8.6 秒内作答 |
| 测试与门禁 | styles.spec（CSS 纪律门）由挂转绿；controls.spec 仅剩 1 失败且 HEAD 基线同挂 3 处（本树更优）；docs 3 失败、commands/environment/deployment 失败均为 **HEAD 基线已有**（worktree 对照实证），非本改动引入 |
| 契约 diff | 概览 O1–O6 逐项保留（问题 8 种行、动作、条件渲染、路由、空态文案原样；新增脉冲条为纯派生 + 唯一重复入口"恢复处理"） |

### 本轮修复的构建回归（记录在案）

改版中发现 `deps.neverBundle` 对 browser/cjs 配置不生效（最小探针复现），react 被内联 → 宿主加载报 `process is not defined`。修复：tsdown 增加 `externalize-react` rolldown 解析插件，在解析层强制 `react`/`react-dom`/`react/jsx-runtime` 外置（371.59 kB，三个 require 由宿主 loader 提供）。


节点：`http://127.0.0.1:3083/?token=<轮换>`——dev home `deepseek\.dsh` 的 `superagent` profile（`link:` 直连工作区 `plugins/dsh-superagent`，bundle 三件 + cordis.patch 三行）。这是 AGENTS.md 合法路径的源码节点；`~/.dsh` 未被写入（3082 桌面 profile 仅复用未改）。

## 协议与实际执行

| 维度 | 预注册 | 实际 | 偏差原因 |
| --- | --- | --- | --- |
| 主题 | 亮/暗 | 仅亮 | **暗格未取证**：web 宿主无暗色 token 层（CSSOM 全量扫描：唯一暗色钩子是 `:root{color-scheme:dark}` 媒体查询；无任何 `.dark`/`data-theme`/dsw 暗色规则；`--dsw-alias-*` 在 body 上为静态亮色值）。桌面宿主按铁律禁写。 |
| 宽度 | 1280 / ~900 / ≤640 | 1440 / 1000 / 700（视口） | 容器断点实测在 640（700 视口 → 容器 639 触发窄构型；1000 → 939 与桌面同构型作中等样本）。三档覆盖两个构型 + 一个中间点。 |
| tab × 宽度 | 全格 | 概览 3 档；来源/执行 2 档（1440+700）；触发/评估/设置 1 档（1440） | 全格补齐在改版后矩阵一并执行（同一协议），改版前以"每构型至少一代表"取证。 |
| 状态 | 空/载/错/有数据/暂停 | 空态天然多；有数据（触发全部线程/评估/执行已结束）；错误态=来源 EINVAL 存量真实态 | 暂停态与剩余 700 格下一回合补；载入态为瞬态，用轮询间隙取证困难，改版后用 devtools 慢速模拟补。 |

## 已采集（before/）

- `overview_1440.png`（容器 1155）/ `overview_1000.png`（939）/ `overview_700.png`（639，窄构型）——真实数据态：系统问题 2（Gitea/GitHub EINVAL）、24h 到达 2 / 已评估 2 / 接单 1、执行器 0/3
- `source_1440.png` / `source_700.png`——三来源：Gitea 出错、GitHub 出错、CMS 任务路由 运行中
- `trigger_1440.png`（默认"已订阅"空态）/ `trigger_all_1440.png`（全部线程 2 条有数据）
- `eval_1440.png`（接单与续做 1 条）
- `execution_1440.png` / `execution_700.png`（进行中空态）/ `execution_ended_1440.png`（已结束 1 条）
- `settings_1440.png`（部署组：状态目录/上限三字段）

## 操作配方（复现用）

- 侧栏「Superagent」与面板内 tab、过滤 pill 的 Playwright 定位器点击会超时——一律 `evaluate` 派发 `MouseEvent('click', {bubbles:true})`（`window.__saClick(text, role)` 助手，见会话记录）。
- 视口切换后立刻截图会报 "screenshot surface preparation timed out"——切完等 ≥1.8s 再拍。
- 主题实验已还原（`data-ds-theme-source="system"` + `color-scheme: light`）。
