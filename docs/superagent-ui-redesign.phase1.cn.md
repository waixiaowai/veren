# Phase 1 — 缺陷台账 + 信息契约清单（dsh-superagent 面板）

> 诊断先于开方；本文件是 Phase 2–5 的依据与验收基线。证据：`evidence/before/`（12 张真机截图，3083 节点）。

## A. 信息契约清单（"功能不变"的核对基准）

### 概览页（本task主战场）

| # | 契约项 | 类型 | 现挂位置 |
| --- | --- | --- | --- |
| O1 | 待处理工单列表（TicketLine question 态：标题链接/阶段标/thread chips/未送达数/note/答复外链/retry/stop/打开 Session） | 数据+动作 | Section `pendingTickets` + count |
| O2 | 空态文案"没有待处理的工单。" | 文案 | 同上 |
| O3 | 系统问题 8 种：setup(飞书/全局)/no-source/no-allowed/executor-paused(恢复处理)/runtime-error/source-error/eval-overdue/eval-unavailable(重排+忽略)/outgoing——各自的标题、详情、hint、动作、路由 | 数据+动作 | Section `problems`（仅有问题时出现）+ count |
| O4 | 过去24小时：到达 / 被过滤(→来源页) / 已评估 / 接单或续做(→评估页24h) / 丢回(>0 才出现,→来源页)；到达与已评估不可链接（注释：按 Trigger 计） | 数据+路由 | Section `lastDay` + 详情›(→触发页 recent) |
| O5 | 执行器：执行中 running/maxWorkers / 排队 / 等待新触发；setup.problem 时整段换成 hint `executorWaitingSetup`（注释：暂停在 problems 里呈现，计数两态同形） | 数据+条件 | Section `executor` + 详情›(→执行页) |
| O6 | `GET overview` error → LoadState error；loading → LoadState loading | 状态 | 页头 |

### 其余五 tab（词汇化改造，契约不增不减）

- **来源**：状态头(hint+设置链接)、全局 setup 问题行、每来源行（Dot 状态、状态文案、received/filtered/lastAt 条件渲染、problem→设置链接、健康备注 error/paused 过滤、被过滤 Disclosure、丢回 Disclosure+工单/线程链接）；设置卡（启用 Switch、未安装 Tag+hint、字段+facts、高级 Disclosure、重启警示、SaveBar、ConfigHistory）。
- **触发**：过滤 pills（已订阅/评估中/24小时/全部）、ThreadLine（阶段标/标题链接/最新预览/chip/扇出目标/轮询错误/时间）、LoadMore。
- **评估**：暂停 banner（→执行页恢复）、决策过滤 pills + 24h pill、DecisionLine（阶段标/标题链接/预览/原因/命中规则/时间）；设置：政策规则（增/复/删/启停/展开校验）、版本号、按来源准入门（三列选择表+警示 slot+同步按钮）、评估块（模式三段/超时/评估模型）、ConfigHistory versions。
- **执行**：状态行（执行器运行中/等待安装/已暂停 + running/maxWorkers/排队 + 暂停恢复 ConfirmButton）、5 过滤 pills、idleHint、TicketLine 列表、LoadMore；设置：执行器块（模型/最大并发）、环境块（目录/准备命令+变量插入表/禁用命令）、SaveBar、ConfigHistory。
- **设置壳**：左侧组导航（来源/评估/执行 stage 分组间距、提示词、部署）+ 右侧标题；部署页（嵌入宿主插件管理器变体）。

### 全局面
搜索（工单/线程/触发三层结果+高亮+20条封顶文案+空态两种）、术语表 Modal（三列+图例五态+值表）、Header（打开主 Session disabled 态）、路由栈 back、locale 双语、轮询 5s/隐藏 30s。

## B. 缺陷台账

### P0 可答性（页面答不出"有事吗/该干嘛"）

| # | 缺陷 | 证据 |
| --- | --- | --- |
| P0-1 | **无系统级判决**：两个来源持续报错、执行器可能暂停，页面却要求用户逐段读四个 Section 自行汇总；暂停态（最关键的"什么都不会跑"事实）只是第三条问题行，页面其余部分纹丝不动 | overview_1440 / overview_paused_1440 |
| P0-2 | **零态无设计**：待处理工单空 = 一行 12px 灰字 + 页面 40–90% 纯空白；无"最近活动/下一步" | overview_1440 |
| P0-3 | **指标无语义**：`.dt-stat-value` 恒 label-primary，0 与 2、丢回>0 与到达>0 视觉同权；数字不编码健康度 | overview_1440（到达 2 与被过滤 0 并排同形） |
| P0-4 | **度量层级塌陷**：值 14px vs 标签 12px，行内 label-value 对读起来像脚注；页面最大字号是 15px 页题 | overview_1440 全部 stat 区 |

### P1 层级与构图

| # | 缺陷 | 证据 |
| --- | --- | --- |
| P1-1 | 无分组容器：Section 只是 13px 标题+散内容，扫描边界弱；与宿主卡片语言脱节 | 全部截图 |
| P1-2 | 问题行动作（恢复处理/重排/忽略）为低存在感 outline 按钮，淹没在文本里；halt-all 类问题与单源问题无视觉分级 | overview_paused_1440 |
| P1-3 | 执行页状态行、过滤 pills、空态 hint 三者同重量堆叠；暂停时状态词 `data-state=warning` 有色但带 NumeriC 对"0/3"仍同色 | execution_1440 |
| P1-4 | 来源页状态值（出错/运行中）远在行右侧，与行标题脱节；行内 24h 统计同样 12/13px 脚注化 | source_1440 |
| P1-5 | 触发/执行过滤 pill 行与内容首行间距不定（有/无 hint 行时），栅格不稳 | trigger_all_1440 vs trigger_1440 |
| P1-6 | **暗色缺口**：web 宿主无暗色 token 层（CSSOM 实证），插件桌面双主题承诺在 web 不可验——词汇层必须只用 alias token（宿主补暗色时自动跟随），禁引静态色 | CSSOM 扫描记录（evidence/README） |

### P2 打磨

| # | 缺陷 |
| --- | --- |
| P2-1 | `dt-hint`/`dt-count` 12–13px tertiary 色对比度待程序化验证（疑 <4.5:1，Phase 5 出表） |
| P2-2 | 空态文案四处同形（没工单/没线程/暂无/没有符合条件的线程），无引导动作 |
| P2-3 | 长标题截断无 title 全文（ThreadLine 有 title 属性，DecisionLine 的 reason 有，但概览 problem 行 detail 无） |
| P2-4 | 详情› 链接 12px 独悬右上，命中区小 |

## C. 改版构图令（Phase 3 执行）

概览页按决策优先级重排，新增词汇一律走 alias token：

1. **脉冲判决条 `.dt-pulse`**（新增，纯派生无新数据）：`error`（halt-all setup / runtime-error）> `paused`（executor-paused）> `degraded`（source-error / eval 逾期 / outgoing）> `ok`；一行判决文 + 关键计数行；paused 时带恢复处理主按钮（唯一允许复制的动作入口）。
2. **注意队列**：工单（O1）→ 问题（O3）原样保留，容器化卡片。
3. **度量瓦片 `.dt-metrics/.dt-metric`**：值 22px semibold tabular-nums 在上、标签 12px caption 在下；零值 caption 色、非零 primary、丢回>0 error 色；可点击瓦片保留原路由。
4. 执行器区同瓦片词汇；setup 等待时保持 hint（契约 O5）。
5. 其余五 tab 只消费：StatusHead/卡片容器/瓦片/空态词汇，不动数据面。
