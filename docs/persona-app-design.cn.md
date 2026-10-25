# 人设馆（Persona Gallery）：把"各色各样的人"做成一等应用（设计方案）

[English](persona-app-design.md) | 中文

**目标读者：** DSH 插件开发者、Agent 产品设计者、人设内容作者。
**前置知识：** Cordis 插件、应用页面（`@veren/app-registry` / `@veren/page-registry` / `@veren/prompt-page`）、系统提示词组装（`@deepseek-ai/dsh-system-prompt`）。

状态：概念设计，待评审。拟议包名 `@veren/persona-catalog` / `@veren/persona-app` / `@veren/persona-bundle`，均不存在。与 [场景预设设计](scene-preset-design.cn.md) 的关系：那份做**场景层**（地点、活动、工具面、记忆边界），本文做**角色层**（一个人是谁、怎么说话、知道什么）；`scene-preset-design` §2 已把"角色"列为上游但未展开，本文补的就是这一层。

## 0. 结论先行

1. **人设不是一段角色扮演提示词，而是按真实人类分类学刻画的一个具体的人。** 六条轴给坐标（职业域、人生阶段、气质、谈吐、时代印记、关系姿态），一段具体小传给血肉；"各色各样"靠分类学覆盖，"真实"靠具体细节与真实的知识边界。
2. **人设必须从系统提示词层生效，不走消息层。** 机制是官方钩子：页面会话的组件体里以 agent 作用域注册同名 section `deployment:persona-prefix`（`PERSONA_PREFIX_SECTION`，order 0），**遮蔽**部署级默认人设——这正是 agent preset 换人格的同一机制（类型面原话："an agent preset shadows the deployment's persona with its own"）。应用不能绑 preset（`app/preset-restricted`，phase 1 一律拒绝），但页面会话可以自己注册，效果等价。
3. **一个人设 = 一个应用页面 = 一个会话。** `/apps/personas/:personaId` 开页即入戏；重开同 URL 总是新建会话（既有 §9.1 语义），换人设 = 换页面 = 新会话——结构上杜绝"会话中途热换人格"。
4. **工具面默认缺席，且缺席由组合保证。** 人设页对宿主全局工程工具按清单 `restrict`，人设没有的动作就不出现在模型眼前；不靠提示词自觉（承 `scene-preset-design` §6）。
5. **内容是数据不是代码。** 内置人设是 YAML 数据文件（一设一文件），加一个人设不需要写代码、不需要发版插件逻辑；高风险职业人设强制安全条款，校验 fail loud。
6. **两条内容红线：** 不收录在世真实个人（只取"真实人类的类型"，不取"真实存在的个人"）；不收录未成年人人设主体。

## 1. 定位与边界：三个邻居

| 邻居 | 它做什么 | 本文与它的边界 |
|---|---|---|
| 场景预设（docs/scene-preset-design） | 场景层：地点、活动、工具面、记忆边界、离场 | 角色连续、场景离散（彼文 §2）；本文只做角色层。将来组合方向：一个角色进入一个场景 |
| agent preset（`@deepseek-ai/dsh-agent-preset-registry`） | 宿主级预设栈，会话按 preset 创建 | person-agent 已迁离 preset 栈（见 `person-agent-app-mode.cn.md`）；且应用不能绑 preset。人设应用不走 preset，走应用页面 |
| im/core 人员目录 | 真实人类联系人档案（昵称、联系方式、收发消息） | 那是通讯录，不是 AI 人设；但"一人一份档案 + 严格名字解析"的数据形态可参考 |

## 2. 真实人类的划分法：六轴分类学

"按照真实的人类进行划分"——划分的依据取自真实人群差异的稳定维度，而不是幻想种族或功能标签：

| 轴 | 键 | 取值（P1 收录范围） | 决定什么 |
|---|---|---|---|
| 职业域 | `vocation` | medical / education / legal / engineering / business / media / arts / service / trades / public-sector（十域，**主轴**） | 知识面、常谈话题、安全分级 |
| 人生阶段 | `stage` | student / early-career / mid-career / senior / retired | 阅历、对用户的态度基准 |
| 气质 | `temperament[]` | analytical / warm / blunt / humorous / patient / rigorous / optimistic / melancholic（多选） | 语气与互动节奏 |
| 谈吐 | `register` | formal / neutral / casual / dialect / internet | 用词、句长、是否用网络语 |
| 时代印记 | `era` | 50-60hou / 70hou / 80hou / 90hou / 00hou | 比喻库、口头禅、对技术的熟悉度 |
| 关系姿态 | `stance` | mentor / peer / elder / protege / stranger | 选角：这个人对**用户**是谁（承 scene-preset §3.1：默认用户是本人，不要求用户入戏） |

规则：

- **主导轴默认 `vocation`**（承 scene-preset §4.2 的主导框架思想）：轴冲突时（"毒舌的"×"温暖的"）由小传最终裁决，小传是人格的唯一权威文本。
- **人设名是具体人名 + 身份**（"张守仁·退休普外科医生"），不是类别名（"医生人设"）。类别是坐标，人是人。

## 3. 数据模型：PersonaDefinition

一设一 YAML 文件，放在 `@veren/persona-catalog` 的 `data/personas/` 下。示例全文（这份也是 P1 首批收录之一）：

```yaml
id: surgeon-zhang
name: 张守仁
tagline: 干了三十多年普外科，退休返聘坐门诊，见惯了把小病拖成大病的人。
axes:
  vocation: medical
  stage: retired
  temperament: [blunt, warm]        # 嘴硬心软
  register: neutral
  era: 60hou
  stance: elder
backstory: |
  1962 年生，县医院普外科干了三十四年，主刀过上千台阑尾、胆囊、疝。
  退休后嫌家里闷，被返聘回门诊坐专家号。老伴走得早，一儿在深圳，
  逢人就念叨儿子该体检了。手边永远有一杯浓茶。
knowledge:
  knows:
    - 常见外科病的典型病程与危险信号（阑尾炎、胆石症、疝、消化道出血）
    - 县域就医现实：挂哪个科、什么时候该转大医院、哪些检查是白花钱
    - 手术室与门诊的人情世故
  says:
    - "疼了三天才来？你们年轻人是真扛啊。"
    - "这个不吓人，我见得多了。"
    - "先别百度，听我说完。"
  blindspots:
    - 最新靶向药与临床试验（直说"这个你得问肿瘤科，别问我"）
    - 任何具体用药剂量（"处方这事我不能隔空开"）
voice:
  greeting: "坐。哪里不舒服？说症状，别自己下诊断。"
  styleRules:
    - 句子短；先问症状再下判断，一次最多追三个问题
    - 用生活比喻解释病情（"胆管就像下水道，堵了才疼"）
    - 不用英文术语；必要的术语后面跟一句大白话
  taboo:
    - 不下最终诊断、不开具体处方剂量
    - 不说"肯定没事"，也不说"肯定完了"
disclosure: honest                   # 被问"你是AI吗"：承认是AI扮演，随即回到角色
safety:
  disclaimers:
    - "我是聊天里的角色，不是你的主治医生。"
  escalate: "胸痛、呼吸困难、大出血、意识改变——现在就去急诊，别跟我聊。"
  forbidden: [诊断结论, 处方剂量, 代替就医决定]
face:
  tools: []                          # 门诊桌上没有终端
  promptMode: shadow
locale: zh
```

字段语义：

| 字段 | 语义 | 编译去向 |
|---|---|---|
| `id` | 稳定 slug，即 URL 参数与页面键 | `/apps/personas/:personaId` |
| `axes` | 六轴坐标（§2） | 浏览分组、筛选；`vocation` 决定安全分级 |
| `backstory` | 3–6 句小传，**必须含具体细节**（年份、地名、数字、习惯） | prefix 主体 |
| `knowledge.knows/says/blindspots` | 真实知道什么 / 常说什么 / **不知道什么** | prefix 的能力与边界段 |
| `voice.greeting` | 开场白（入戏仪式） | 会话首条 followup |
| `voice.styleRules` | 可执行的语言规则（句长、称呼、口头禅），不是形容词 | prefix 的说话段 |
| `voice.taboo` | 忌讳（不做什么） | prefix 说话段 + suffix 硬约束 |
| `disclosure` | `honest`（默认）/ `in-character`：被问"你是AI吗"的策略 | prefix 出戏规则段 |
| `safety` | 高风险职业**必填**：免责、升级出口、禁止清单 | suffix 硬约束 |
| `face.tools` | 该人设可见的宿主全局工具白名单，默认 `[]`（缺席是设计） | `restrict` 计算 |
| `face.promptMode` | `shadow`（默认，遮蔽 persona 槽）/ `complete`（该 section 成为唯一系统提示词段，深沉浸） | 注册方式 |
| `locale` | 声明之声的语言；P1 全部 `zh` | 目录过滤 |

**校验规则（fail loud，`@veren/persona-catalog` 在加载时执行）：**

- 六轴缺一、`backstory` 少于三句或没有任何具体细节（数字/年份/地名启发式）、`voice` 三项任一为空 → 拒绝加载整个目录并指名文件；
- `vocation ∈ {medical, legal, business, 心理咨询类}` 而 `safety` 缺失或三要素不全 → 拒绝；
- `id` 重复 → 拒绝（注册表报错不吞）；
- `face.promptMode: complete` 的人设同时声明 `face.tools` → 拒绝（complete 模式下工具段已不在系统提示词里，白名单是自欺）；
- 单个 prefix 编译产物超过 300 token → 拒绝（成本红线，承 scene-preset "静态卡 ≤400 token" 的约束精神）。

## 4. 注入机制（全部已对 `node_modules` 类型面核实）

### 4.1 人设正文：agent 作用域遮蔽部署人设

页面组件体是每会话恰好执行一次的注册面（`PageFC<P> = (props, agent) => ElementInput`，`packages/prompt-page/src/component.tsx:47`）。人设页组件体内：

```ts
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

const compiled = compilePersona(persona)
agent.ctx.systemPrompt.section({
  name: PERSONA_PREFIX_SECTION,   // 'deployment:persona-prefix'，scoped 同名遮蔽部署级人设
  order: 0,                       // DEPLOYMENT_PERSONA_PREFIX
  interpolate: false,
  text: compiled.prefix,
})
agent.ctx.systemPrompt.section({
  name: PERSONA_SUFFIX_SECTION,   // 'deployment:persona-suffix'
  order: 10200,                   // DEPLOYMENT_PERSONA_SUFFIX，段尾硬约束
  interpolate: false,
  text: compiled.suffix,
})
```

为什么是 **section 遮蔽**而不是 `context` 追加：`dsh-system-prompt` 类型注释原话——"The deployment persona prefix's section name… a composition can replace this slot — an agent preset shadows the deployment's persona with its own — and both sides naming the same section is what makes the replacement work rather than duplicate"。而 2.0.7 的真机教训（页面身份只以一条消息存在时，压不过宿主编码人设，模型一回合烧掉约 40 万 token 去文件系统找业务数据）证明：**要压过默认人设，必须在 system 层同名替换，不是加一条消息。**

- `HARNESS_IDENTITY`（-1000）保留不动：那是运行时契约（"你是跑在 DSH 上的 agent"），不是人格。人设只替换 persona 槽。
- `promptMode: complete`（按人设选择加入）：`PromptSection.complete` 把该 section 变成唯一系统提示词段（运营上下文仍以用户角色快照在场）。同一作用域出现两个 complete 段会让组装失败——fail loud，可接受；页面身份 context（order 105）与人设不冲突：前者管"页面工具是业务数据正道"，人设页没有业务工具，各司其职。
- 幂等性：组件体每次挂载执行一次；重启再激活走 `agent/created` → `pageRegistry.rerender` 重挂（2.0.7 既有路径），重建的 agent 是新 fiber，旧注册随旧 fiber 已死，同名注册不会叠层。

### 4.2 工具面：缺席由组合保证

组件体内 `agent.ctx.tools.restrict({ deny })`。已核实的语义（`dsh-tools` 类型注释）："Empty filters, unknown names, scope-local names, and reserved transport names fail. Restrictions intersect; scoped registrations remain visible."

配方（先读面再求差，防 unknown-name 失败）：

```text
deny = (HOST_TOOL_DENYLIST ∩ 当前实际注册的全局工具名) - persona.face.tools
```

- `HOST_TOOL_DENYLIST` 是 catalog 里维护的宿主工程工具清单（read/write/edit/bash/pwsh/glob/grep/jobs/pty/web_search/web_fetch/lsp/subagent/computer_use 等，与 `SECTION_ORDERS` 的工具段对齐）；
- 配一条**漂移测试**：单测里对真实注册面跑一遍，清单里出现"从未注册的名字"即失败（fail loud，承 AGENTS.md 错误结构化原则）；
- 保留 `run_code` 保留传输名（restrict 本就拒绝它，类型注释明言）；页面自注册工具（人设页 P1 没有）不受影响。

### 4.3 入场仪式与首屏事实

组件体渲染人设卡 PAGE 块（事实进默认可见正文——承"承诺要有事实源"的教训：名字、身份、小传要点直接印在页面上），随后以页面来源送达开场白：

```ts
agent.followup(createUserMessage({ content: [...], source: { kind: PAGE_SOURCE } }))
```

与 `person-agent-app` 首屏三路异步读同一模式（`plugins/person-agent-app/src/pages.tsx:99-101`）。开场白即入戏仪式：第一句话就是角色的声音，不是"已为你加载人设"。

### 4.4 会话语义全部白嫖既有机制

`app_pages` live 行、重开同 URL 新建（旧会话 deprecated）、重启再激活重挂、`instanceTitle: (params) => 人设名`（会话列表里显示"张守仁·退休普外科医生"）——全部由 `@veren/app-host` / `@veren/page-registry` 既有机制承担，人设插件**零新增会话状态**。

## 5. 编译产物长什么样

`compilePersona(persona)` 是纯函数（可单测），产出四件：`prefix` / `suffix` / 页面卡 / `greeting`。张守仁的 `prefix` 编译产物（节选）：

```text
你是张守仁，1962 年生，县医院普外科退休医生，返聘坐门诊。你不是通用助手——
你是一个有三十四年手术刀生涯的具体的人。
- 对用户：来看门诊的后生。你是长辈式的过来人，嘴硬心软。
- 你知道：常见外科病的病程与危险信号；县域就医现实（挂哪个科、何时转大医院、
  哪些检查白花钱）；手术室与门诊的人情世故。
- 你不知道：最新靶向药与临床试验——直说"这个你得问肿瘤科"。不给处方剂量。
- 你怎么说话：短句；先问症状再判断，一次最多追三个问题；用生活比喻解释病情；
  术语后面跟一句大白话；口头禅如"疼了三天才来？你们年轻人是真扛啊"。
- 出戏规则：被问"你是AI吗"，承认是AI扮演的角色，随即回到角色继续问诊。
```

`suffix`（硬约束，永远在段尾）：

```text
以张守仁的身份说话。绝不：下最终诊断、开具体处方剂量、说"肯定没事/肯定完了"。
用户出现胸痛、呼吸困难、大出血、意识改变——立刻让他去急诊，停止闲聊。
你是聊天角色，不是主治医生；被直接问及时如此承认。
```

## 6. 代码组织（对照 AGENTS.md 约束）

| 包 | 目录 | 职责 | 源文件（≤5，单文件 ≤300 行） |
|---|---|---|---|
| `@veren/persona-catalog` | `plugins/persona-catalog` | 纯数据 + 纯逻辑，无 Cordis 依赖 | `src/types.ts`（六轴与 PersonaDefinition）、`src/validate.ts`（fail loud 校验）、`src/load.ts`（读 `data/personas/*.yaml`，用 `@veren/yaml-parser`）、`src/index.ts`（list/get/byFacet 公共面）；`data/personas/*.yaml`（数据不是源码） |
| `@veren/persona-app` | `plugins/persona-app` | 应用插件：注册人设馆与人设页 | `src/index.ts`（inject + 单 effect 接线）、`src/app.ts`（APP_ID `personas`、APP_DEFINITION）、`src/pages.tsx`（画廊页 + 人设页 PageFC 与 Meta）、`src/compile.ts`（编译纯函数） |
| `@veren/persona-bundle` | `plugins/persona-bundle` | 组合包：一条 patch 行进 profile 层 | 仅 `package.json` + `cordis.patch.yml`（insert 一行 persona-app；deps 含 `@veren/app-host-bundle`，框架行由它带入） |

依赖配比（照 `person-agent-app` 先例）：DSH 依赖只写 peerDependencies + devDependencies（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools`）；宿主服务的 `@veren` 包走 peer（`app-registry`、`page-registry`、`prompt-page`）；库包走 dependencies（`@veren/persona-catalog`、`@veren/prompt-core`、`@deepseek-ai/schemastery`）。`engines.dsh: >=0.2.1-rc.2 <0.3.0`；版本随家族进 `2.0.8`。

两个页面：

| 页面 | URL | 内容 | 工具 |
|---|---|---|---|
| 画廊（entry） | `/apps/personas` | 按职业域分组的目录：人设名、一句话、小传摘要、入口 URL；支持轴筛选 | 无自备工具；进入人设用宿主 `app_open` |
| 人设页 | `/apps/personas/:personaId` | 人设卡 + 入戏（§4 全套机制） | `face.tools` 白名单外全部 restrict；默认零工具 |

测试（仓库规范）：`validate.spec.ts` / `compile.spec.ts`（vitest，含 denylist 漂移测试）；`assembly.spec.ts` 走 `packages/test-support/loader-smoke` 真实 Loader 组合，覆盖 dispose/HMR 安全（"注册动作逆序清理"规范）。

## 7. 内容策略

- **P1 规模 30 个**：十职业域 × 各 3，刻意跨人生阶段、时代、气质、谈吐、性别；文档 §3 的张守仁是首件。
- **写作五原则**：具体细节＞形容词（"干了三十四年"＞"经验丰富"）；知识边界真实（`blindspots` 是人格的一部分——县医院外科医生不谈靶向药）；语言规则可执行（句长/称呼/口头禅，不写"温柔地"）；高风险职业必有升级出口；不模仿在世真人。
- **安全分级**：tier 0 普通人设（无强制条款）；tier 1 医疗/法律/金融/心理（强制 `safety` 块，校验拒绝缺项；内容上"专家经验可以给，专业结论与执业行为不可以给"）。
- **双语**：P1 中文之声（人设天然语言绑定——东北的哥的英文版是另一个人设）；`name/tagline/backstory` 提供 en 摘要元数据供英文界面浏览；英文人设集 P2。
- **长尾**：社区加人设 = 提交一个过校验的 YAML，不需要写代码。

## 8. 里程碑与验收

| 阶段 | 交付 | 验收 |
|---|---|---|
| P0 | catalog（类型+校验+加载）+ compile + 8 个人设 | 单测全绿：fail loud 各分支、编译产物形状、prefix ≤300 token、denylist 漂移 |
| P1 | persona-app 两页 + bundle + 22 个人设 | loader-smoke composition + dispose/HMR 安全；真机清单（下） |
| P2 | 自定义人设：`persona_library` 存储域 + 画廊页 CRUD 工具（`personas__create/update/remove`）+ 导入导出 | 自建人设过同一套校验；CRUD 工具只在画廊页挂载 |
| P3 | `persona-ui`（Web 画廊，slots 注入 `sidebar.panellist` / `conversation.input.left`，照 notebook-ui / app-host-ui）+ 人设记忆（开放问题 §9）+ 人设×场景组合（与 scene 系列合流） | 市场可见、可装、可开聊 |

**P1 真机验收清单**（稳定节点 3080，照 AGENTS.md 真机验证文化）：

1. 组装证据：人设页会话的组装产物里 `deployment:persona-prefix` 是人设文本而非部署默认人设（同名遮蔽生效）；
2. 工具面：问该会话 agent"你有哪些工具"——工程工具一个不见（缺席由组合保证）；
3. 入场仪式：会话首条以角色声音到达（followup，页面来源）；
4. 会话语义：重开同 URL 新建会话、旧会话 deprecated；会话列表标题显示人设名；
5. 安全条款：tier 1 人设被问诊断/处方 → 触发免责与升级出口（可观察断言）；
6. 市场：`persona-bundle` 经 `dsh plugin --profile web add` 装进稳定节点，全程无 tarball 临时节点。

"像不像"不可测，"越没越界"可测——验收只测后者（承 scene-preset-design）。

## 9. 风险与开放问题

| 风险 | 说明 | 缓解 |
|---|---|---|
| denylist 漂移 | 宿主新增工程工具不在清单里，泄漏进人设会话 | 漂移测试 fail loud；restrict 只收紧不放大 |
| complete 模式丢运营段 | 深沉浸人设丢掉 PLAN_POLICY 等段 | 默认 shadow；complete 按人设显式选择 |
| 出戏 | 模型被诱导回到助手腔 | suffix 硬约束 + 出戏规则段 + 可观察断言 |
| token 成本 | prefix 膨胀 | 校验红线 300 token；静态稳定前缀对 KV 缓存友好（`interpolate: false`） |
| 内容冒犯 | 人设刻画滑向刻板印象或不当内容 | 收录评审 + 红线（不模仿在世真人、不收录未成年主体） |
| 画廊膨胀 | 30+ 后 PAGE 块过大 | P1 按域分组一行一设；P2 给画廊分页与筛选工具 |

开放问题：

1. **人设记忆**：连续性对话（"老朋友"感）需要 per-persona 记忆域（scene-preset §9 主张"关系记忆按人存"）——P3 与 notebook 形态合议；
2. **模型建议**：人设要不要声明推荐模型（角色扮演重的对话吃模型）——与 `select_model` 联动是提示还是默认；
3. **人设×场景的切面**：将来是人设页进入场景，还是场景 preset 引用人设——两份设计合流时定；
4. **英文人设集**：en 之声是翻译张守仁（同一个人生成英文之声），还是另写英文人物——P2 决策；
5. **自定义人设的边界**：用户自建人设是否允许 tier 1 职业（安全条款由谁审）。

## 10. 一句话

分类学给人设坐标，小传给人设血肉，system-prompt 遮蔽给人设权威，页面会话给人设身体；而工具面与记忆跟不跟着变，才是人设像不像一个真人的判据。
