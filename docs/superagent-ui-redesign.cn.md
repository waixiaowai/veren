# dsh-superagent 面板 UI 重设计任务（专业设计师标准 · 功能不变）

> 状态：**Phase 0–3 与 Phase 5 主门禁已完成（2026-11-03）**，Phase 4 部分完成（主列 960→1200px 全局受益；来源/执行页状态行构图修正延后），Phase 5 机器门禁已跑（详见 `evidence/README.cn.md` 裁决表）。四问加深（2026-11-03），本文件即重写后的任务。
> English version: [superagent-ui-redesign.md](superagent-ui-redesign.md)

## 0 一句话

把六 tab 管理面板从"数据罗列"重排为"分诊面"（triage surface），全部用 DSH 宿主自己的设计系统词汇完成，信息与功能一字不减。核心缺陷不是"丑"，是"无构图"。

## 1 设计命题（改版的第一依据）

每个 tab 一句话写清"用户到此页要做的决定"，排序与层级只从这里推导：

| Tab | 用户来此要做的决定 |
| --- | --- |
| 概览 | 有需要我的事吗？系统健康吗？东西流到哪了？（3 秒三问） |
| 来源 | 通道都接好了吗？谁在漏（dropped）？ |
| 触发 | 哪些线程在等判定？最近流量正常吗？ |
| 评估 | 判定历史健康吗？有没有积压？ |
| 执行 | 工单跑到哪一步了？卡住了吗？ |
| 设置 | 能不能少配置一点就跑起来？ |

不确定某信息放哪一层时，回到这张表，不靠审美直觉。

## 2 现状取证（已核实的代码事实）

- `src/client/` 共 27 文件约 4400 行；`client.css` 382 行——**超出单文件 300 行硬约束，本任务必须顺手拆分**（按词汇域分文件，css.d.ts 同步补声明）。
- 已有工程底子（redesign **不得回退**，只能在其上构图）：`--dsw-alias-*` / `--dsw-static-*` 宿主 token、focus-visible 焦点环、640px 容器断点、prefers-reduced-motion、tabular-nums、双语 locales、术语表 Modal。
- 概览页缺陷（真机截图证实）：
  - 零态 = 一行 12px 灰字 + 约 90% 空白，无判决、无锚点；
  - 指标 14px 值与 12px 标签几乎同权，读起来像脚注；
  - `.dt-stat-value` 恒为 label-primary 色，数值不反映健康度；
  - 无系统级"脉搏"判决条，四段按数据结构排序而非决策优先级。
- 功能面 = 信息契约：`GET overview` 返回 `person[] / problems[] / flow{received,filtered,judged,accepted,dropped} / executor{running,maxWorkers,queued,idle}` + `setup`；条件渲染（dropped 仅 >0、executor 等待 setup 提示、问题区仅在有问题时出现）与全部动作（requeue / dismiss / resume / check-setup / 各详情链接）都是契约的一部分。

## 3 阶段（先诊断后开方，禁止跳步改码）

### Phase 0 — 改版前证据矩阵

- 在稳定测试节点真机（`DSH_HOME=deepseek\.dsh`，端口 3080，唯一合法验证路径）采集：
  **6 tab × 亮/暗主题 × 3 档宽度（1280 / ~900 / ≤640）× 关键状态（空 / 加载 / 错误 / 有数据 / 暂停）**。
- 截图用 `scripts/cdp-shot.mjs`（9222 调试口）或 browser-use 自动化；这是"改版前"基线，入库留档。
- 非零态用**最少侵入的真实注入**（如 `POST executor/pause` 造 paused 问题、触发器 requeue/dismiss、断开凭据造 setup 问题）；产不出的格子明标"未取证"并写原因，**禁止造假数据截图**。

### Phase 1 — 诊断台账（不改一行码）

- 对基线截图做启发式评估（Nielsen 十条）+ 模糊/眯眼测试（视觉层级审计）；
- 产出缺陷台账，按 **P0 可答性 / P1 层级与构图 / P2 打磨** 分级，逐条挂到 §1 命题或 §2 事实上；
- 同步产出**信息契约清单**：六 tab 现渲染的每一字段、每一动作、每条路由的编号清单（改版后逐项核对用）。

### Phase 2 — 词汇层重设计（interface inventory）

- 盘点全部复用元素：Section / Stat / Card / Row / Tag / Dot / Empty / LoadState / Banner / Pulse（新增）…；
- 拆分并重写 `client.css` 为词汇域文件（建议 tokens / controls / sections / pages 四域，各 ≤300 行）；
- 钉死**状态→颜色语义映射**（healthy→success/idle、需注意→warn、故障→error、运行中→business），脉搏条、状态点、数值着色全部从这一映射取色；
- 度量层标尺：值/标签两级字号（值显著大且 tabular-nums）、零值降权（caption 色）、非零升权（primary 色）；
- 纪律：零硬编码色值/字号；间距 4/8pt 栅格；类型 ≤5 档。

### Phase 3 — 概览页旗舰重构

- 构图顺序 = 决策优先级：**脉冲判决条**（系统级一句话判决 + 关键计数，从状态映射取色）→ **注意队列**（工单 + 问题，含各自动作）→ **过去 24 小时流量** → **执行器负载**；
- 零/载/错/有数据四态各是完整构图：空态给"一切安静 + 最近活动 + 下一步指引"，不是一行灰字；
- 全部字段、条件渲染、动作、路由与 §2 契约逐项对齐。

### Phase 4 — 其余五 tab 词汇化改造

- 只消费 Phase 2 词汇做层级与构图修正，不新造私有组件；每 tab 改完即回真机补拍对应格。

### Phase 5 — 裁决门禁（全部通过才算完）

1. **改版后截图矩阵**（同 Phase 0 口径）入库，前后对照；
2. **对比度脚本报告**：按主题 token 程序化算 WCAG 比率，正文 ≥4.5:1；
3. **5 秒盲测**：给一个未预热的新会话 agent 只发改版截图，两问"现在有事吗？该点哪？"——秒答且答对为过，问答记录入库；
4. **信息契约清单 diff 为空**：Phase 1 清单逐项在改版后 UI 可寻（位置可变、不可消失）；
5. **机器门禁全绿**：`pnpm check`（含 function-length 门禁）+ 相关 spec + typecheck；
6. **族内归属性**：与 person-agent / task-workbench 页面并排截图，被认作"同族产物"。

## 4 硬约束

- **功能不变的检验定义** = Phase 1 信息契约清单改版后 diff 为空；`api.ts` / `route.ts` 不动；locales 键只增不删不改义；diff 限定在表现层（className / JSX 构图 / 纯展示组件）。
- 双主题、≤640px 容器断点、reduced-motion、焦点环全部保持。
- 宿主 token 优先；**禁止**私有视觉语言（渐变、重阴影、异形圆角、外来字体）；不加新依赖。
- 单文件 ≤300 行、函数 ≤30 行；双语注释。
- 稳定测试节点唯一：`DSH_HOME=deepseek\.dsh`，3080；**禁碰 `~/.dsh`**。
- 参照语料只取构图思路（Vercel / GitHub Actions / Temporal / Dagster / Linear 的概览、空态、状态语义三个切面），不抄代码不抄皮。

## 5 交付物清单

- [x] Phase 0 基线截图矩阵（12 张，`evidence/before/`）+ Phase 5 改版矩阵（7 张，`evidence/after/`）
- [x] Phase 1 缺陷台账 + 信息契约清单（[phase1.cn.md](superagent-ui-redesign.phase1.cn.md)）
- [x] 状态矩阵并入 Phase 1 台账 C 节构图令；暗色格"未取证"已记录（web 宿主无暗色 token 层）
- [x] 拆分后的词汇层 CSS（styles/ 四文件，350 选择器无损迁移）+ 改版后的 tsx（overview 重构 + widgets.Metrics）
- [x] 对比度报告、盲测记录、门禁输出（`evidence/README.cn.md` 裁决表）
- [ ] Phase 4 余项：来源/执行页状态行改用度量瓦片词汇；P2-3/P2-4 打磨项
- [x] 本文件状态更新完毕
