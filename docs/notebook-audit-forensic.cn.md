# notebook 真实使用取证审计（预注册协议）

状态：**判据冻结**（2026-11-03，本提交先于一切统计）
关联：`docs/notebook-note-types.cn.md`（缺口回填目标）、`docs/notebook-audit-results.cn.md`（结果，统计后产出）

## 0. 任务

不审快照，审过程。从稳定节点（`DSH_HOME=deepseek\.dsh`）的原始会话日志重建"盒子怎么被用"，以预注册判据产出可复现审计，把缺口清单从"判断"升级为"有机械证据的发现"。上一轮审计（2026-11-02，基于 storage 终态快照）的三个方法缺陷在此修正：

1. 只看终态 = 幸存者偏差（删掉的卡、被拒的写入不可见）；
2. 事后归因（先看数据再找基准）；
3. "64% 残渣"是肉眼判定，无操作化规则。

## 1. 生料（审计只吃这些，禁吃二手聚合）

| 生料 | 位置 | 用途 |
| --- | --- | --- |
| 会话日志 | `deepseek\.dsh\sessions\<scope>\<sessionId>\session.v4.jsonl.zstd`（zstd 多帧） | 事件表：`tool/call`（name/callId/arguments/time）× `tool/result`（callId 对接） |
| 存储原始行 | `deepseek\.dsh\storages\notebook.json`（tables.notes / tables.links） | 终态行 + 幸存率分母 |
| 相邻域存储 | `storages\task_center.json`、`app_pages.json` | 卡是否被任务/页面消费过 |
| 当前实现源码 | `plugins/notebook/src/`（841c630 一线） | 仪表的仪器规格：stale/谜面/转轨的代码语义 |
| 一手外部数字 | 比勒菲尔德讲义 PDF（互引 20k+30k / 卡 24k+66k）；sspai.com/post/95590（1282 链/483 卡） | 基线只引原文数字，禁引二手转述 |

## 2. 预注册判据（冻结，统计后不许回改）

### 2.1 残渣/真卡操作化规则

- **机械规则（脚本执行，确定性）**：`title ∪ body` 匹配正则 `/(验收|回归|验证|探针|rc\d|probe|verify|smoke)/i` → 判 **R**（验证残渣）；否则判 **T**（真内容）。
- **边界写死**：标题含 `rc6` 的卡判 R，即使正文含真内容——规则先于内容直觉。
- **双评分者交叉验证**：两个独立评分者（互不可见对方结论、不见机械规则）对全部终态卡判"验证残渣 vs 真内容"，与机械规则对比报一致率。**一致率 ≥80% → 机械规则可用于 G1 清理通道的自动预筛；<80% → 机械规则只作参考，清理通道必须人审。**
- 双评分者的目的：验证**检测器**，不是重分类——G1 提议的残渣清理通道需要一个经过验证的预筛器。

### 2.2 标题纪律的可操作面

中文"断言句"难以机械判定，改测更硬的替代面：**元数据入标题**。规则：title 匹配 `/[0-9]{2,}|%|[0-9]{4}[-年]|[0-9]+\.[0-9]/` → 判"标题夹带元数据"。

### 2.3 飞轮漏斗阶段定义（事件表 × 终态）

| 阶段 | 操作定义 | 数据面 |
| --- | --- | --- |
| F1 captured | `create`/`capture` 成功事件涉及的卡 id 数 | 事件表 |
| F2 processed | 被再次触碰（update/read/find/backlinks 等命中该卡）≥1 次的卡 | 事件表 |
| F3 linked | 终态有 ≥1 链接（出或入）的卡 | notebook.json |
| F4 reused | 创建 ≥7 天后仍被读/列事件引用的卡 | 事件表 × 时间 |
| F5 compounded | 成为**创建时间晚于自己**的卡的链接目标的卡 | links × createdAt |

### 2.4 可证伪预测（先于数字写下，结果只报 PASS/FAIL）

- **P1** 真卡（T 类）中"标题夹带元数据"占比 < 1/3。（若 FAIL → G3/G7 证实）
- **P2** F5/F1 ≥ 1/3（三分之一的卡最终成为后来者的链接目标——飞轮在转）。（若 FAIL → 飞轮未转的证据）
- **P3** 真卡链接密度 ≥ 1.0 链/卡（卢曼一手基线下界 ≈0.56，sspai 2.65）。（若 FAIL → 密度赤字证实）
- **P4** 日志中存在 ≥1 次 notebook 工具拒绝（link-unresolved / title-conflict / card-referenced / note-not-found）——写入纪律面在真机上真实拦截过。
- **P5** 幸存率 < 100%：create 成功事件数 > 终态行数（存在被删的卡）。

### 2.5 设计主张降级为假设（逐条验）

- **H-A** "写入时纪律：链接必须已存在" → 数据检验：links 表全解析 + 日志验 link-unresolved 拒绝面真实存在。
- **H-B** stale = 无入链且超 7 天（STALE_DAYS=7）→ 代码行引用 + 数据复算比对。
- **H-C** "分类是查询不是 schema"（rc.1 前立场）→ 已被 kind 列推翻，记录为设计演进（drift），不判失败。

## 3. 方法与工具（确定性）

1. **提取**：zstd CLI（v1.5.7）逐会话解压 → Node 逐行解析 JSONL → 只取 `tool/call`/`tool/result` 且 name 含 `notebook__` → 事件表 JSON（含 session/时间/工具/参数/结果码）。
2. **分析**：单一确定性脚本入库 `plugins/notebook/scripts/audit-forensics.mjs`，直接吃 notebook.json 原始行 + 事件表，输出 JSON 读数；重跑同数。
3. **机械证据**：缺口断言用 grep/代码行引用/现有测试结果佐证，禁"我认为"。
4. **幸存率**：F1 成功 create 事件数 vs 终态行数，差值列出（被删/被拒的尝试）。

## 4. 外部裁决者（验收不由你我）

1. 复现：任何人重跑脚本得同一组数（命令在结果文档里）。
2. 预注册时序：本文件 git 提交时间戳早于任何统计提交。
3. 一致率 ≥80% 阈值裁决机械规则可用性。
4. 每条缺口有机械证据或显式推翻记录。
5. 基线全部一手可核查（URL+数字）。

## 5. 预测登记（对 rc.1 真机验收，真机腿复核）

- **PR1** 审计判 T 且形态属 project 的卡（预期：定价策略草稿）在 reclassify 路径落地后会被实际移动。
- **PR2** 孤岛数仪表（G4）落地后，稳定节点首读数 = 本审计终态算出的孤岛数（3）。
- **PR3** ledger 上线 14 天内，G1 残渣通道能把机械规则判 R 的卡全部列出（当前终态下为 8 张，若双评分者一致率达标）。

## 6. 交付物

- `docs/notebook-audit-results.cn.md` + 英文孪生：结果、PASS/FAIL 表、缺口重审、复现命令。
- 缺口升级版回填 `docs/notebook-note-types.cn.md` §4/§6（中英）。
- 脚本 `plugins/notebook/scripts/audit-forensics.mjs`。
