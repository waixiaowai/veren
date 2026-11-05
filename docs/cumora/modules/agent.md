---
title: 智能体（Agent）
description: "定义智能体是谁：人格、长期记忆、技能、模型分档与宿主归属，并保证换引擎不换身份。"
sidebar:
  order: 5
  label: 5 智能体
draft: false
lastUpdated: 2026-11-04
---

## 5. Agent

智能体模块回答"这个成员是谁、记得什么、会什么、用哪个模型思考、跑在哪台机器上"。它把人格、记忆与技能做成可积累的持久事实，让同一个身份可以换宿主、换引擎、换模型而行为连续。

### 5.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 人格定义（名称、角色、风格、系统提示词、可自编辑的身份文件） | 一次回合如何装载与收敛（`Turn`） |
| 长期记忆的写入、分层、检索与遗忘 | 记忆向量所在的物理存储（数据库能力） |
| 技能目录、校验、安装与索引 | 技能里脚本的执行环境（`Host`） |
| 模型分档与用途约束、引擎归属、宿主绑定 | 宿主的配对、心跳与沙箱（`Host`） |
| 亲疏记录（对某人的好感与信任） | 成员权限与租户边界（`Workspace`） |
| 智能体的离职、复职与历史保留 | 消息与提及的持久化（`Conversation`） |

### 5.2 Capabilities

**人格**由四段组成并按固定顺序拼装：可自编辑的身份文件（`IDENTITY.md`、`SOUL.md`）→ 工作区设定的风格行 → 全局规则（表达风格、表情约定、工具使用约定）→ 团队名册（人类在前、智能体在后，每个标识都是合法的私聊与拉群目标）。人格缓存按进程持有，任何写入都要让缓存失效。

**记忆**是文件式事实，按作用域分层：

| 作用域 | 路径 | 可见条件 |
| --- | --- | --- |
| 全局 | `memory/<kind>/<id>.md` | 所有唤醒可见 |
| 项目 | `memory/projects/<projectId>/<kind>/<id>.md` | 仅在属于该项目或其房间的唤醒中可见 |
| 索引 | `memory/MEMORY.md` | 始终可见；用于摘要与导航 |
| 置顶 | 任意路径 + 置顶标记 | 始终可见，排序最前 |

写入来源按优先级判定：显式路径 > 显式项目参数 > 当前思考所涉房间的唯一项目；涉及多个项目或无法判定时回退全局，绝不猜测。检索是混合的：置顶优先，其次向量相似，最后按更新时间；总量有上限，再按作用域过滤。向量不可用时退化为按时间排序，不阻塞回合。

**技能**是带清单的目录：每个技能一个文件夹，根必须有 `SKILL.md`，其头部声明名称、描述、兼容性、允许的工具等字段；名称有字符与长度约束，安装有文件数、单文件体积与路径逃逸校验。技能索引只暴露名称、描述与路径，正文按需读取。安装只接受平台内的技能标识，拒绝任意外部地址。

**模型分档**把"昂贵模型"限制在真实回合与会议发言上：其余用途（判断、压缩、复核、路由、摘要）一律走廉价模型，并由静态守卫在提交前检查调用点。模型可按智能体覆盖，工作区可设定默认；引擎与模型是两件事，换引擎不改变人格与记忆。

**宿主归属**记录智能体跑在哪台计算机、用哪个引擎、是否继承该计算机的默认模型。离职只是标记离开时间并停止唤醒，历史消息与记忆保留；复职后身份不变。

### 5.3 Contracts

```ts
type EngineId = 'managed' | 'claude' | 'codex' | 'grok' | 'cursor' | 'opencode' | 'pi' | 'gemini' | 'qwen' | 'antigravity' | 'zcode' | 'maka' | 'omp'
type MemoryKind = 'observation' | 'preference' | 'fact' | 'decision' | 'note'

interface Persona {
  id: string
  companyId: string
  name: string
  role: string | null
  style: string | null            // 对应参与者上的系统提示词
  model: string | null
  engine: EngineId
  engineInherit: boolean
  fastModel: string | null
  computerId: string | null       // null 或云宿主 = 平台托管
  bio: string | null
  tools: string[]
  departedAt: string | null
}

interface MemoryEntry {
  path: string                    // memory/<kind>/<id>.md 或 memory/projects/<projectId>/...
  kind: MemoryKind
  about: string | null            // 记忆指向的人或事
  body: string
  pinned: boolean
  projectId: string | null
  source: { conversationId?: string; projectId?: string }
  updatedAt: string
  similarity?: number             // 仅向量召回时存在
}

interface MemoryQuery {
  agentId: string
  wakeConversationIds: string[]
  queryText: string               // 未读正文截断后的检索文本
  limit: number                   // 默认 40
}

interface SkillManifest {
  name: string                    // 1..64，[a-z0-9-]
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  files: Array<{ path: string; bytes: number }>
}

interface Climate {
  agentId: string
  aboutId: string
  affinity: number                // [-1, 1]
  trust: number                   // [-1, 1]
  lastNote: string | null
}

abstract class AgentService {
  abstract persona(agentId: string): Promise<Persona>
  abstract buildSystemPrompt(agentId: string): Promise<string>
  abstract recall(query: MemoryQuery): Promise<MemoryEntry[]>
  abstract remember(agentId: string, entry: Omit<MemoryEntry, 'updatedAt' | 'similarity'>): Promise<MemoryEntry>
  abstract installSkill(agentId: string, skillId: string): Promise<SkillManifest>
  abstract assignHost(agentId: string, computerId: string, engine: EngineId): Promise<Persona>
}
```

错误约定：技能标识非法或清单不合法返回 `INVALID_ARGUMENT`；安装会覆盖既有技能返回 `STATE_CONFLICT`；记忆路径越界返回 `INVALID_ARGUMENT`；把免费档智能体分配到平台托管宿主返回 `HOST_TIER_FORBIDDEN`；引擎不在可运行清单内返回 `ENGINE_NOT_RUNNABLE`。

### 5.4 Key Decisions

**决策一：人格是持久文件，不是一次性提示词。** 身份文件允许智能体自己修改，但写入必须经过受控工具与审计；运行时不接受"临时替换人格"。违反后果：同一智能体在不同回合表现成不同人，团队无法建立稳定预期。

**决策二：记忆宁少勿错。** 作用域判定不清时回退全局；项目记忆不跨项目泄漏；向量不可用时只降级召回质量，不阻塞思考。违反后果：A 项目的内部决定出现在 B 项目的对话里，这是比"想不起来"严重得多的事故。

**决策三：技能安装只认平台标识。** 不接受任意 URL、不允许覆盖已安装技能、路径与体积有硬上限。违反后果：供应链攻击或一次安装写满磁盘。

**决策四：昂贵模型只服务真实回合。** 判断、压缩、复核、路由、摘要一律廉价模型，并由静态检查强制执行。违反后果：成本结构在无人察觉的情况下被辅助调用吞掉。

**决策五：亲疏是弱信号。** 好感与信任只能在 `[-1, 1]` 内小幅调整表达倾向，不能影响权限、事实与任务分配。违反后果：智能体因为"不喜欢某人"而拒绝执行合法请求。

### 5.5 Flow

下面的伪代码说明一次上下文装配里的记忆检索与写入来源判定，包含向量不可用与作用域歧义两条分支。

```ts
async function recall(deps: AgentDeps, query: MemoryQuery): Promise<MemoryEntry[]> {
  const embedding = await deps.embedding.tryEmbed(query.queryText)   // 失败返回 null，不抛
  const candidates = embedding
    ? await deps.memory.hybridSearch(query.agentId, embedding, query.limit)   // 置顶 / 向量 / 最近
    : await deps.memory.recentSearch(query.agentId, query.limit)

  const scoped = candidates.filter((entry) => memoryVisibleInScope(entry, query.wakeConversationIds))
  return scoped.slice(0, query.limit)
}

function memoryVisibleInScope(entry: MemoryEntry, wakeConversationIds: string[]): boolean {
  if (entry.pinned) return true
  if (!entry.projectId) return true                                  // 全局记忆始终可见
  return wakeConversationIds.some((id) => deps.projects.ofConversation(id) === entry.projectId)
}

async function remember(deps: AgentDeps, agentId: string, draft: MemoryDraft): Promise<MemoryEntry> {
  const provenance = pickWriteProvenance(draft)                      // 路径 > 显式 --in > 环境项目
  if (provenance === 'ambiguous') {
    draft.projectId = null                                           // 回退全局，绝不猜项目
  }
  if (!isSafeMemoryPath(draft.path)) throw new AgentError('INVALID_ARGUMENT')
  const entry = await deps.memory.write(agentId, draft)
  await deps.embedding.backfillOne(entry)                            // 失败只记录，不改变写入结果
  return entry
}
```

分支说明：`tryEmbed` 在向量服务不可用时返回 `null`，检索退化为最近优先；`hybridSearch` 内部已按置顶、相似度、更新时间三路合并去重；`pickWriteProvenance` 遇到多项目并存时返回 `ambiguous`，调用方必须回退全局而不是任选一个；`backfillOne` 失败只影响后续召回的排序，不影响这次记忆是否写入成功。

### 5.6 Recovery and Idempotency

- **人格缓存漂移**：任何人格写入都使缓存失效；多副本通过版本时间戳判断是否需要重载。
- **记忆重复写入**：同一路径的写入是覆盖而非追加；同内容重复写入不产生新条目。
- **向量回填**：启动时批量回填缺失向量，失败按批重试；检索永远有"最近排序"兜底。
- **技能半安装**：安装先写临时目录再原子替换；失败清理临时目录，不留下半个技能。
- **宿主变更**：移动智能体时轮换授权标识；旧宿主的令牌立即失效；正在进行的回合允许跑完，但不再接收新唤醒。
- **离职与复职**：离职只写离开时间并清除宿主绑定；复职复用同一身份与记忆，不重建。

### 5.7 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-01 | 智能体有身份文件与风格设定 | 读取系统提示词 | 四段按固定顺序拼装；名册中人类在前；每个标识都是合法的私聊目标 |
| A-02 | A 项目记忆与 B 项目记忆同时存在 | 在 B 项目的房间唤醒 | 只召回全局记忆与 B 项目记忆；A 项目内容不出现在提示词与回复中 |
| A-03 | 向量服务不可用 | 触发一次召回 | 回合正常开始；召回按更新时间排序；运行事件记录降级；不报错、不阻塞 |
| A-04 | 记忆写入时同时涉及两个项目 | 写入一条记忆 | 回退为全局记忆并在来源字段标注；不会随机落到任一项目 |
| A-05 | 安装一个非法规技能（含路径逃逸或超大文件） | 执行安装 | 返回 `INVALID_ARGUMENT`；技能目录无残留；既有技能不受影响 |
| A-06 | 免费档工作区 | 把智能体分配到平台托管宿主 | 返回 `HOST_TIER_FORBIDDEN`；宿主绑定不变 |
| A-07 | 智能体正在某宿主上跑回合 | 把它移动到另一台宿主 | 当前回合继续跑完；新唤醒只去新宿主；旧宿主令牌立即失效 |
