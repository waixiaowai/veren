---
title: skill 行为与展示层
description: 触发、风险分级、展示规则与重试策略。
sidebar:
  order: 4
---
## 2.4 Skill

skill 是行为与展示层：它判断一句话是否该触发能力、把意图收敛成受约束的调用序列、在危险动作前取得确认、把结果组织成用户能读懂且不漏链接的回复。它与相邻模块的分界是：skill 不实现任何文件操作、不拼接链接、不解释内部标识，也不自行猜测服务端能力——命令层没有的能力，它只报告"需要更新"，不尝试用未知参数绕过。

### 2.4.1 Capabilities

【实现】行为面共七组规则，全部以"必须/禁止"表述，避免模型自由发挥。

| 组 | 规则要点 |
|---|---|
| 触发 | 同时满足"提到网盘相关词"与"意图明确"才触发；同会话内已有网盘操作时，后续消息可省略关键词；非网盘操作、本地记忆整理、其他云盘一律不触发 |
| 前置检查 | 依次检查安装、登录、路径；未安装先取得用户同意再安装；未登录且属于原任务前置时，走"继续原任务"模式静默返回；路径必须在授权根内 |
| 风险分级 | 高危：删除、显式覆盖、下载目标已存在；中危：路径不明确的传输与文件管理；低危：容量、列表、检索、分享、建目录、会员入口 |
| 确认 | 高危必须先列出对象、类型、数量与不可逆后果，等待明确确认；同一批对象确认一次有效，目标集合变化必须重新确认；用户取消立即终止 |
| 执行策略 | 大文件按 50 MB 分界：不超过则直接执行并放宽单次超时，超过则后台执行并轮询进度；轮询必须向用户报告进度与最终结果 |
| 展示 | 链接优先取预渲染字段并原样输出；内部标识（文件标识、归属标识、追踪标识）不得出现在面向用户的文本里；路径统一显示为"我的应用数据/bdpan/…"；不得用脚本裁剪结果字段 |
| 版本对齐 | 技能版本声明所需命令版本；版本不符时提示用户确认安装或更新，不自行替换安装 |

### 2.4.2 Key Decisions

- 先判风险再执行，高危动作必须"明确意图 + 明确确认"：删除与覆盖不可逆。
- 中间态不得表述为完成：已提交不等于已保存，进行中不等于失败。
- 链接原样透传、不裁剪结果字段：裁剪会静默丢掉查看入口。
- 能力缺失只报告不绕过：猜测未知参数会被静默忽略，产生错误结果。
- 恢复策略：确认集合变化时重新确认；失败只重试失败项并设总时限；用户取消立即终止。

### 2.4.3 Contracts

```ts
interface Utterance {
  text: string;                            // 用户原始文本
  sessionId: string;                       // 会话标识，同会话复用
  hostName: string;                        // 宿主名称
  priorTurnsHadDriveOp: boolean;           // 会话内是否已发生过网盘操作
}

interface TriggerDecision {
  matched: boolean;
  reason: "keyword-and-intent" | "context-continuation" | "no-keyword" | "ambiguous-intent" | "other-cloud" | "local-memory-task";
  candidateCommand: string | null;         // 命中的子命令，未命中为 null
}

type RiskLevel = "low" | "medium" | "high";

interface RiskAssessment {
  level: RiskLevel;
  objects: Array<{ displayPath: string; kind: "file" | "dir"; count?: number }>;
  consequences: string[];                  // 不可逆、连带删除、旧内容不可恢复等
  requiresConfirmation: boolean;
}

interface DisplayPlan {
  lines: Array<
    | { kind: "summary"; text: string }
    | { kind: "path"; text: string }
    | { kind: "link"; markdown: string }
    | { kind: "note"; text: string }
    | { kind: "list"; items: Array<{ label: string; detail?: string; linkMarkdown?: string }> }
  >;
  hiddenFields: string[];                  // 必须隐藏的内部标识字段名
}

interface RetryPlan {
  allowed: boolean;
  onlyFailedItems: boolean;                // 只重试失败项
  intervalSeconds?: number;                // 30 至 60
  deadlineSeconds?: number;                // 总时长上限 300
  userMessageWhileWaiting?: string;
  userMessageOnDeadline?: string;
}

interface SkillRuntime {
  decide(utterance: Utterance): Promise<TriggerDecision>;
  assess(command: string, args: Record<string, unknown>): Promise<RiskAssessment>;
  planDisplay(command: string, result: unknown): Promise<DisplayPlan>;
  planRetry(failureCode: string, detail: string): RetryPlan;
}
```

错误约定：skill 不吞掉命令层错误；它把错误码翻译成"发生了什么 + 为什么 + 下一步"，并在无法判断时明确说"暂时无法确认"，不给出猜测性结论（例如把任务查询被拒说成"转存失败"）。

### 2.4.4 Flows

```ts
async function handleUtterance(utterance: Utterance): Promise<string> {
  const decision = await runtime.decide(utterance);
  if (!decision.matched) return replyUnrelated();                      // 明确说明未触发，不执行任何命令

  await ensureInstalled();                                             // 未安装 -> 取得同意后安装
  const auth = await command("whoami", { json: true });
  if (!auth.loggedIn) await loginFlow({ continueTask: true });         // 前置登录，静默继续

  const commandArgs = parseIntent(decision.candidateCommand, utterance.text);
  const risk = await runtime.assess(decision.candidateCommand, commandArgs);
  if (risk.requiresConfirmation) {
    const answer = await askUser(renderConfirm(risk));                 // 列出对象、类型、数量、后果
    if (answer !== "confirmed") return replyCancelled();               // 取消或含糊一律不执行
  }

  const result = await command(decision.candidateCommand, commandArgs);
  if (!result.ok) {
    const retry = runtime.planRetry(result.errorCode, result.error);
    if (retry.allowed) return await retryWithDeadline(result, retry);
    return renderFailure(result);                                      // 保留错误码与原因
  }
  return render(await runtime.planDisplay(decision.candidateCommand, result.data));
}
```

展示环节的取数规则必须逐命令固定，否则最容易出现"结果有链接、回复没链接"的静默失败：

| 命令 | 结果位置 | 链接字段 | 展示要求 |
|---|---|---|---|
| `ls` | 顶层数组 | `return_markdown`（缺失时 `return_url`） | 每项一个链接，名称列不得丢链接 |
| `search` | 顶层 `items[]` | `return_markdown` | 逐项输出，不得重排成无链接清单 |
| `search-content` | `data.hits[]` | `file_url` | 每条命中一个链接；本命令无 `return_markdown` |
| `get-content` | `data[]` | `return_markdown`（异步项也有） | 正文与链接同条回复 |
| `get-content-result` | `data.files[]` | `return_markdown` | 同上 |
| `upload` / `download` / `cp` / `mv` / `rename` / `mkdir` / 单文件 `transfer` | 结果对象 | `return_markdown` | 结果后追加一行链接 |
| `share` | 结果对象 | `link` / `short_url` | 不复用回端链接 |
| `rm` | 结果对象 | 无 | 只报告实际删除数量 |

### 2.4.5 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| SK-01 | 新会话 | "帮我看看网盘里有什么" | 触发列表命令，逐项输出名称与链接；不输出文件标识 |
| SK-02 | 新会话 | "帮我整理一下本地下载目录" | 不触发，说明未涉及网盘 |
| SK-03 | 已登录 | "删掉 report.pdf" | 先列出对象与不可逆后果并等待确认；未确认不调用删除 |
| SK-04 | 已确认同一批对象 | 再次回复"确认" | 直接执行，不重复询问；命令带强制跳过交互开关 |
| SK-05 | 目标集合新增一项 | 修改删除清单后回复"确认" | 重新确认，不沿用上次确认 |
| SK-06 | 覆盖上传 | "把最新版传上去覆盖旧的" | 展示源与目标并二次确认；确认后 `action=overwritten` |
| SK-07 | 60 MB 文件下载 | "下载这个大文件" | 后台执行并轮询，每隔一段时间报告进度，完成后报告落点 |
| SK-08 | 文档类 `get-content` | "读一下这份 PDF" | 先提示需要等待，返回任务号后说明已转后台；拿到正文后与链接同条输出 |
| SK-09 | 任务查询被拒 | 转存后查询返回权限错误 | 说明"任务已提交、暂时无法查询"，不重复提交、不判失败 |
| SK-10 | 正文命中 | "文档里提到验收吗" | 每条命中带链接；占位文案不得当作正文展示 |
| SK-11 | 命令返回未登录 | 任意文件操作 | 走登录流程，成功后继续原任务，不输出独立欢迎语 |
| SK-12 | 技能版本高于命令版本 | 任意操作 | 提示需要更新命令，不自行安装 |
| SK-13 | 用户说"算了" | 任意进行中的确认 | 立即终止，不执行任何命令 |
| SK-14 | 结果含 3 个文件 | 任意批量操作 | 回复中恰好 3 个链接，且与文件一一对应 |
