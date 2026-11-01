# 优化计划：查漏补缺（2026-11-01 评审稿）

> 状态：已批准执行（2026-11-01）。背景：对 DeepSeek 官方研究原型 dsh-superagent-prototype
> （MIT，本仓库 `deepseek/dsh-superagent` 只读参照）做架构对比审计后制定。
> 英文版见 [optimization-plan.md](optimization-plan.md)。

## 0 · 审计结论（漏在哪）

结构性缺口（对比官方原型）：

| # | 缺口 | 证据 | 官方参照 |
| --- | --- | --- | --- |
| G1 | 无统一可靠性脊柱：task-center `service-delivery.ts` 与 im `core/src/queue.ts` 各自手工维护重试/幂等/顺序；已付学费＝回执武装竞态、attempts 无 dispose | 官方 `src/app/effects.ts`（161 行）+ outbox 回执表（幂等 id / behind 检查 / never-queue-twice） |
| G2 | 模型面无回归门禁：PAGE 块、挂载工具名、技能名穷举校验靠人肉 | 官方 `tests/model-surface.spec.ts` |
| G3 | 决策沉淀有稿无锁：docs/ 有设计稿，但无"不变式+拒绝清单"层，无文档↔代码同步测试 | 官方 `tests/docs.spec.ts`（穷举强制） |
| G4 | 单写者无仲裁：多插件共享 storage 域，无 claim 制 | 官方每张表/每条健康条目标注唯一写者（`HealthBoard`） |
| G5 | 内存态不抗重启：workbench store 重启重置（2026-10-25 验收在案） | 官方状态全部 SQLite + 事务 |

在案欠账（清偿清单）：IM 队列真机四件（正常回复确认/3连/重复/杀宿主/终态审计）；无人值守契约收尾（3080 模型腿、审计数字、push）；workbuddy-auth Phase 0 探针 + 真机 7 项；person-agent push + npm deprecate；tool-face actor 双轨租约缺陷；dsh-superagent 收尾（gh CLI/9 问/hourly check）。

## 1 · 范围裁定（不做什么）

- 不整体移植官方原型：27K 行单进程 POSIX 单体，与跨平台多插件生态不同构。
- 不重写投递面为统一框架：只抽公共核 `@veren/effects`，调用方保留各自语义；im 接入须 task-center 先落。
- 不动市场/版本/三环境体系（本方领先项，不为"对齐官方"倒退）。
- AGENTS.md 裁定：现行文本「包内源文件数不设硬上限、按职责聚合」为准，5 文件特例不再存在，无需改文件。

## 2 · 四条泳道

### S1 · 可靠性核 `@veren/effects`（P0）
- 生料：官方 effects.ts 语义（事务内入队 / kind+key 合并 / `Later` 暂缓不计失败 / 指数退避 / ordered 阻塞 / quiet 健康 / generation 防覆盖）+ outbox 回执语义。MIT，移植语义并注明出处，不 vendor 文件。
- 方法：独立包，**双后端**＝内存（测试）+ DSH 存储适配（运行时，不自带 sqlite）；先接 task-center，im/core 下一棒（串行）。
- 裁决：杀进程重启不丢/不重/不乱序的并发 spec；task-center 既有测试全绿；真机 3080 与"IM 真机四件"合并验收。

### S2 · 模型面门禁 `check:model-surface`（P1）
- 方法：穷举应用页 PAGE 块/map 行/挂载工具名/技能名与注册面比对 + 尺寸预算；挂进 `pnpm check` 链；自测走 `check:gate-selftest` 模式。
- 裁决：对 18 页无人值守契约出首份报告，**抓出至少一个真漂移**才有效；抓不出＝门禁太松，回炉。

### S3 · 决策沉淀 + 文档同步（P1）
- 方法：每包一页 `domain.md`（不变式表 + 拒绝清单），先做 task-workbench / im/core / app-host 三包；新增 `check:docs`：文档声明的服务/工具/事件名必须在代码中存在（仅单向，避免过度工程）。
- 裁决：门禁绿；每条不变式能指到至少一个测试名。

### S4 · 欠账清偿（P0 速赢）
| 项 | 动作 | 裁决 |
| --- | --- | --- |
| IM 真机四件 | 与 S1 验收合并跑一次真机 | 日志见 TASK 块 + delivered |
| 无人值守契约收尾 | 补 3080 模型腿 + 审计数字 + push | origin 领先归零 |
| workbuddy-auth | 用户确认 Phase 0 探针 → 真机 7 项 | 探针证据落文件 |
| person-agent | push + npm deprecate 退役包 | install 走新包 |
| actor 双轨缺陷 | 单独评审任务 | 红绿回归在案 |
| dsh-superagent 收尾 | 用户装 gh → wrapper + 9 问 | `status` exit 3→0 |

## 3 · 排序与并行安全

S4 立即 → S1（串行：包 → task-center → im）→ S2/S3 并行；S2/S3 同在 scripts/ 故并为一道。
并行规则：目录所有权先声明；各泳道只跑自己的测试，全量 `pnpm check` 由主会话收口后统一跑；官方源码只读不 vendor。
