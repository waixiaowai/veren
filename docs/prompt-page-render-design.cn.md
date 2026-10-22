# PAGE 块渲染面重构设计：WYSIWYG JSX（HTML 词汇 → Markdown 渲染）+ cordis 直调

- 状态：RFC v2（2026-10-21 收敛；草案，未实施）
- 范围：`@veren/prompt-core`、`@veren/prompt-page`、`plugins/page-registry`、示范插件（本文附录 A 的任务中心三页）
- 关联：`docs/application-concept.cn.md`（§3.9/§3.10 页面规范沿用该文档的编号与语义）

## 0. 先把结论说清楚

1. **WYSIWYG**：页面组件 = PAGE 块的唯一渲染面。组件体从上到下写，模型就从上到下读到；React 的可读性从来不是"写得少"，是"写的就是出的"。
2. **词汇表 = HTML 全集，渲染目标 = Markdown**。React 的原语本来就是 HTML 标签，这里输出域是 Markdown，于是：原语 = HTML 标签（全集，表外标签透明降级），渲染器 = 一张固定的 HTML→Markdown 映射表（§3.2）。**内置特殊组件数 = 0**。
3. **语言全量开放**：`.map()`、三元、`&&`、可选链、模板串直接写进 JSX。
4. **视图钩子面极小**：`useState / useMemo / useSnapshot / useContext`（需要槽位/栈记账的才叫 hook）；effect 与订阅**不设钩子**，组件体内直调 `ctx.effect` / `ctx.on`（render 期由调度器记账，§5.3）。
5. **工具动态生成**：组件在页面会话作用域内 `ctx.tools.register(defineTool(…))`（dsh-tools 原生 API，Scoped tools shadow globals）；派发/审批/结果投影走宿主既有 `tools/*` 管线（§5.4）。
6. **生命周期即事件**：`page:ready` / `page:dispose` 两个通知事件挂在 pageCtx 上（§5.5）；监听者随会话销毁自动清理。
7. **接入面全部复用既有服务**（§3.5）：注册走 `apps.register` / `apps.pages(id).register` / `apps.tools(id).define`（本提案只扩展 pages.register 接受 PageFC 组件）；跨会话通知走 `pageRegistry.deliverUrl`（投递即建会话/唤醒）；工具走 `ToolDefinition`（§5.4）。自造的 router/messages/tools 门面全部撤销。
8. **两条本域设计决定**：变化即补丁——重渲后发生变化的元素子树渲染为 Markdown，以 `PAGE-PATCH` 块追加历史（key 负责对位，§A.6）；首屏数据唯一合法来源是 `load`（模型读的是文档，先空后满的文档对模型是误导）。
9. **复用优先**：effect、事件、清理、依赖注入全部复用 cordis 既有设施；自有新机制只剩 fiber 槽位记账、假值规范化、Markdown 序列化器、context 栈四样。

## 1. 背景与问题诊断

旧形态（`defineAppPage` + `tree` + `Static/Data/Keyed`）读不出"模型看到什么"，三层断点：

1. **原语说引擎方言**：`Static/Data/Keyed` 是 diff 记账类型，不是文档词汇；
2. **文档一半不在 JSX 里**：PAGE 块头行（params/data/map/tools/说明）由 `pageBlock()` 在另一个包拼装；
3. **最终文本隔两个序列化器**：要心算 `pageBlock()` + `renderSync()` 才知道模型读到什么。

## 2. 决策记录：已否决的方向

- **D1（否决）config 化**：去 JSX、页面变纯配置。把"可读性"错误优化成"写得少"；config 仍要脑内模拟拼装。
- **D2（否决）闭合行组件**：`<Rows items={...}>` 把投影逻辑藏回组件，与旧 `Keyed` 同病。
- **D3（否决）自造文档方言组件集**：`PageBlock/Section/Notes/Field/Collection/Row/Map/Unavailable` 这套中间形态——仍要学一套新词、给框架添加内置面，违背"尽量少内置特殊 Component"。被 **HTML 全集 + Markdown 映射**替代：作者用全人类已会的词汇，框架零内置组件。

## 3. 目标设计

### 3.1 四条原则

1. 组件 = PAGE 块唯一渲染面（写一次语义、§3.10.2 规范形状不变，头行拼装点在框架）；
2. 词汇 = HTML 全集（输出域 Markdown 的本族词），机制藏进渲染器；
3. 语言全量 × 内置组件为零；
4. 复用优先：cordis 已有的（effect/事件/生命周期/注入）一律不造。

### 3.2 HTML → Markdown 映射（渲染契约）

| HTML | Markdown | 备注 |
| --- | --- | --- |
| `h1`–`h6` | `#`–`######` | |
| `p` | 段落（空行分隔） | |
| `ul` / `ol` / `li` | `-` / `1.`（嵌套缩进） | `li` 的 `key` = splice 记账单元 |
| `table` `thead` `tbody` `tr` `th` `td` | GFM 表格（首行表头） | `tr` 的 `key` = 行级记账单元 |
| `a[href]` | `[text](href)` | 站内 href 与 map/URL 同源、可照抄 |
| `strong`/`b` · `em`/`i` · `del` | `**` · `*` · `~~` | |
| `code`（行内） | 反引号 | |
| `pre > code` | ``` 围栏块 | |
| `blockquote` | `>` | |
| `hr` | `---` | |
| `br` | 换行 | |
| `div` `span` `section` `article` 等容器 | 透明 | 只渲染子内容，不产生文本 |
| 其余未知标签 | 透明（策略位） | `script`/`style` 内容丢弃 |

全局规则：文本节点原样输出（转义 Markdown 特殊字符）；"支持所有 HTML 标签" = **全函数**——任何标签都有确定渲染结果，未知标签降级为其子内容，永不崩。文本节点是一等公民（Markdown 的主载体），内容转义规则进序列化器测试。

### 3.3 PAGE 块骨架：框架拼头行，组件渲染正文

```md
PAGE <app>.<page> <canonical-url>
map:（能力地图——…）           ← router 从注册表推导（§3.5）：本应用兄弟页逐条成行
tools: <动态挂载集>（用途短语）  ← commit 后 pageCtx 上的实际工具（§5.4）
说明：<meta.instructions>

<组件渲染出的 Markdown 正文>
```

组件只负责正文；头行由框架拼装（`pageBlock()` 收敛为头行拼装 + Markdown 序列化）。**头行无 JSON**：params 由 URL 本身表达（map 模板给出参数名），不设 data 行——meta.load 的结果经 `useSnapshot()` 进组件、由组件渲染为 Markdown 正文；正文是组件的全函数输出、永远在场（原"data 行永远在场"由正文承担），load 抛错 → 组件收到失败态如实渲染，未处理时框架兜底渲染失败 blockquote。`meta.description` 供应用索引/能力发现（会话文档之外），不进正文。

### 3.4 definition/meta 逐字段处置

| 字段 | 处置 | 理由 |
| --- | --- | --- |
| `url` / `description` | 保留（注册、索引、能力发现） | 会话文档之外的元数据 |
| `load` | 保留 | 首屏数据通道之一（外源权威数据）；结果经 `useSnapshot()` 进组件渲染为 Markdown（失败态一并交付）。页面自承载数据走组件体内 `ctx.effect` + `useState`（§5.2），`load`/`store` 都不填 |
| `instructions` | 保留 | 框架拼进头行 |
| `map` | **删除——由 router 从注册表推导** | 注册表已持有全部 url 模板 + description，手写是又一处双通道复述（§3.5） |
| `tools`（静态清单） | 保留于 meta | 能力清单：市场/权限/发现需要静态面（§5.4 两张脸） |
| `tree` / `instanceTitle` / 页内 `tools` 声明 | 删除 | 被组件、`<h1>`、`ctx.tools.register` 替代 |

### 3.5 接入面（北星形态——全部复用 DSH 既有服务面）

注册、工具、投递、事件**全部是既有 API**（`ctx.apps` registrars、`deliverUrl`、cordis `ctx.effect`/`ctx.on`）；本提案新增的只有"页面可以是组件"这一注册签名与渲染记账内核（§7）：

```tsx
export const inject = ['apps', 'pageRegistry'] as const

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps

  // 单一 effect 收线（G13 规则 3）：定义 → 工具 → 页面，失败逆序回滚
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      // 1) 应用定义（既有面）：id / name / description / entry / instructions
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) 工具目录（既有面）：ToolDefinition 原样登记
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of collectAppTools(ctx)) done.push(tools.define(tool))
      // 3) 页面注册（既有入口；本提案只扩展：页面可以是 PageFC 组件，
      //    适配器内部包成 PageDefinition，镜像进 page-registry 不变）
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(TaskListPage))
      done.push(pages.register(TaskNewPage))
      done.push(pages.register(TaskDetailPage))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => undefined
  }, 'tasks-app:wire')

  // 数据变化 → 按 URL 幂等投递（既有通路 pageRegistry.deliverUrl）：
  // 该 URL 有活会话 → 消息追加并唤醒；没有 → 新建页面会话
  // （首帧渲染、工具挂载、PAGE-PATCH 全是会话自己的固定行为）。
  // 非页面会话的通知走既有 taskCenter.send 收件箱通路。
  ctx.on('tasks/changed', async (p: { taskId: string }) => {
    await ctx.pageRegistry.deliverUrl(`/apps/tasks/${p.taskId}`, {
      message: `[tasks] 任务 ${p.taskId} 有更新，请查看最新状态`,
    })
  })
}
```

定案语义：

- **投递即建会话/唤醒，不需要手工 render**：`deliverUrl` 对活会话追加消息并唤醒，对缺席 URL 新建会话——新会话的首帧渲染、`ctx.tools.register`、diff 补丁都是页面会话的固定行为。v1 草案的"`{messages, tools}` 手工成对投递"撤销：向非页面会话注入走既有 `taskCenter.send` 收件箱通路；
- **快照注入 ≠ 活页会话**：`deliverUrl` 投的是写一次的消息，不跟随后续更新；要跟随就在该 URL 建活页会话；
- **map 由 router 推导，meta 不再有 map 字段**：注册表已含全部兄弟页的 url 模板与 description——`map:` 头行由框架在渲染期生成（本应用全部兄弟页、排除自身、按注册序，`- 模板 → description`），输出格式逐字不变（真机教训针对"模型需要可照抄的行"这一输出格式，不是针对手工维护）。手写 map.use 与 description 的互相复述随之消灭；§3.10.1 规则 1（首页列全记录页）从"lint 核对的承诺"变成"构造上成立"。跨应用导航走正文 `<a>` 与宿主应用目录，不进 map。

## 4. 原生表达式：现状与缺口

已具备（现源码即可）：`.map()` 元素数组（beginWork 数组规范化 + Fragment）、keyed 对位与异型重建、开放宿主词汇（`HostKind = string`，未知类型宿主忽略 = 策略位）。

缺口：**G-A 文本节点**（Markdown 主载体，裸插值 `{t.title}` 落 `text` 块）；**G-B 假值规范化**（`false`/`null`/`undefined` 在 reconcileChildren 入口跳过）。

## 5. 视图钩子、effect 与事件

### 5.1 视图钩子面与各自杀死的痛点

| API | 作用 | 杀死的痛点 |
| --- | --- | --- |
| `useState(initial)` | 组件本地状态（取数缓存/视图状态） | 组件自持取数镜像，重渲走既有调度器（定位 §5.2） |
| `useMemo(dep, compute)` | 纯派生 | 视图内派生数据的标准答案 |
| `useSnapshot()` | 读 render 输入（meta.load 结果 / store 最新状态） | 组件与首屏数据的类型化通道 |
| `useContext(Context)` | 读最近 Provider | 宿主向组件注入事实（如 URL 参数） |
| `ctx.effect(run, cleanup?)` | **代替 `useEffect`**：render 期只记账（槽位 + 调用序去重），commit 后执行一次，清理随会话逆序。**无 deps**（§5.3） | `load`/`onLoad` 双写退场；登记/清理零新机制 |
| `ctx.on(name, handler)` | **代替 `useEvent`**：render 期记账、随会话清理 | 响应式复用事件总线，与生命周期观察方同一写法 |

### 5.2 `useState` 的定位与自承载组件惯用法（2026-10-21 修正）

初版"不提供 useState"反对对象找错了：页面持有的典型状态是 **ctx 服务的本地缓存镜像**——缓存不是第二事实源，权威事实仍在服务层（React Query/SWR 同款区分）。修正为：**提供**，定位取数缓存与视图状态；"自造事实"（页面出现系统里不存在的数字）走 lint 与评审。如实代价：手动取数不随外部变化自动重渲（`useSnapshot` 会）。分层：共享 store 数据走 `useSnapshot`；一次性取数/局部视图状态走 `useState` + `ctx.on` 失效。

**自承载组件惯用法（页面数据的默认形态）**：页面 = 模块级组件，**没有工厂、没有闭包注入**——组件 ctx 携带完整宿主服务面（声明合并的 `ctx.apps` / `ctx.taskCenter` / 各插件服务原样可读，仅 tools/effect/on 三个成员被会话 facade 重载），props 即 URL params。数据加载写在组件体内：

```tsx
export const ListPage: PageFC = (_props, ctx) => {
  const [rows, setRows] = useState<Row[]>([])
  ctx.effect(() => { void loadRows(ctx.workspaceRegistry).then(setRows) })   // 挂载即加载
  return <ul>{rows.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
}
```

**纪律：effect 内的 `setState` 必须落在渲染帧之外**（异步读取 / microtask 包装）——effect 的 run 在 render 期内联执行，同步 `setState` 会重入渲染帧、打乱 hook 调用序。外源权威 store（变化源在页面之外）仍走 `meta.store` + `useSnapshot`；两者可按页面各取所需。

### 5.3 effect 与事件：`ctx.effect` / `ctx.on` 直调，render 期记账

不引入 `useEffect`/`useEvent`。**机制**：render 期对二者的调用只记账不执行（fiber 槽位、调用序 + 实参引用去重，重渲不重复登记）；commit 后统一执行；清理随会话销毁逆序（ctx.effect 通道）。会话死后挂起中的回调不得再写状态（unmounted 守卫）。

**定案：不重载 deps**——第二参保持 cordis 语义；"依赖变化重跑"用 **key 重挂**替代，响应式用 `ctx.on` 订阅（`useState` 镜像 + `ctx.on('tasks/changed', reload)` = 事件驱动失效）。

**如实代价**：① 调用序纪律换皮仍在（省掉名字省不掉契约）；② lint 需区分 render 期（记账）与 apply 期（立即登记）作用域，比纯 hooks 名单更依赖组件命名约定。

**域守卫**：页面只做观察方——只订阅 emit/parallel 类通知，禁止在 serial/bail/waterfall 拦截类事件上挂监听（视图不得影响宿主控制流）。

### 5.4 工具：`ctx.tools.register(defineTool(…))`，零新 API（2026-10-21 修正）

工具由组件动态生成——注册时 props/ctx 已在闭包内。**注册与构建器全部复用 `@deepseek-ai/dsh-tools`**：`defineTool(options)` 产出 registry-ready 的 `ToolDefinition`（`InferArgs` 从参数 spec 推导 `execute` 的 args 类型），注册走 `ctx.tools.register`：

```tsx
import { defineTool } from '@deepseek-ai/dsh-tools'

// 在页面会话的 agent 作用域内注册——"Scoped tools shadow globals"是注册器文档写明的原生语义
ctx.effect(() => ctx.tools.register(defineTool({
  name: 'task_take',
  description: '接取任务；taskId 取列表行首的编号',
  parameters: { taskId: { type: 'string' } },          // ParameterSchemaSpec → JSON Schema
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: async (args) => {                           // args 类型由 InferArgs 推导，无需 as 窄化
    await ctx.tasks.take(args.taskId)
    reload()
    return `已接取 ${args.taskId}，责任人变更为当前用户`
  },
})))  // register 返回精确 disposer → ctx.effect 通道逆序卸载
```

三条定案：

1. **注册即作用域**：`ctx.tools.register` 在调用方 agent 作用域内注册，"Scoped tools shadow globals" 是注册器文档写明的原生语义——作用域互斥与重开 URL 工具摘除（真机清单第 4/5 项）由此免费获得；返回的精确 disposer 经 ctx.effect 通道随会话逆序清理；`ctx.tools.restrict` / `guard` 亦按需白拿；
2. **派发走宿主既有 `tools/*` 管线**：`tools/pre-execute`（审批/门）→ `tools/execute`（超时/重试/度量包装）→ `tools/post-execute`（结果策略）→ `tools/result`（冻结结果通知）与 `tools/change`（工具集变化通知，页面 tools 行的重建正好订阅它）全部现成；
3. **result → 消息由宿主既有管线负责**：canonical value 经 `output.render` 投影为 ContentBlock，注册表归一化后由 agent 循环落日志——一次 tool_call 恰好一条 tool result，页面层零代码。

**静态清单与动态实例是两张脸**：meta 声明能力清单（collectAppTools——市场/权限/发现需要静态面）；页面在会话作用域内 register 的是本会话实例。§3.9 承诺对齐 = commit 后比对 JSX 声明的 promise 与该作用域内实际注册的 fact（`tools/change` 即事实源）。

### 5.5 页面生命周期事件

pageCtx 上以 declaration merging 声明两个通知事件（`@mode: emit`）：

| 事件 | 触发时机 | 正当观察方 |
| --- | --- | --- |
| `page:ready` | meta.load 完成 + 首帧 commit 之后 | 会话/应用层编排（投递泵、遥测、任务通知注入） |
| `page:dispose` | 会话销毁开始、清理执行前 | 同上；随后框架逆序跑完全部清理 |

只有两个：补丁节奏是渲染管线内部事（不发事件）；load 失败是数据不是事件。**两层分工**：组件内"就绪后跑一次"唯一拼法是 `ctx.effect(run)`（组件拼法的 page:ready）；会话层编排监听生命周期事件。时序：ready 时首帧已有数据——它是活刷新/编排起点，不是首屏取数通道。

## 6. 本域特有的设计决定（与 React DOM 分道处）

1. **变化即补丁：重渲后发生变化的元素子树 → Markdown 片段进 `PAGE-PATCH` 块，追加到会话历史**。React 逐 text node 更新是给像素看的；这里 op 数即 token 预算。key 是对位记账（模型按行首编号更新对该行的认知），不是补丁门槛；从不变化的静态内容天然永不进补丁。交付层自动完成，作者零代码（§A.6）。
2. **单面**：children = Markdown 视图，模型读到的唯一事实源；`key` = 记账。不设 JSON 对账行（v1 的 `data:` 行已删）——正文即数据，失败态也是正文；模型对数据的引用来自它读到的正文（如行首 `**T-1024**`），不会出现"读正文、引 data"两张皮。
3. **Context 实现**：render 阶段同步，模块级栈即可，无需并发安全设计。

## 7. 实现改造清单

### prompt-core

- **C1** reconcileChildren 假值规范化（G-B）；
- **C2** hooks 槽位：fiber 按调用序索引、跨渲染持久 + `ctx.effect`/`ctx.on` 记账 + commit 后冲洗队列（清理经 pageCtx.effect 通道）；组件第二参数 ctx 透传；命名避开现有 `Effect`（文档 op）；
- **C3** memo bailout × 槽位互作（bail 跳过执行不丢槽位）；
- **C4** 渲染期 context 栈。

### prompt-page

- **C5** HTML 宿主词汇全集 + **Markdown 序列化器**（§3.2 映射表 + 转义 + text 块）+ 视图钩子（`useState/useMemo/useSnapshot/useContext`）+ render 期记账语义；
- **C6** 调用序 lint（render 期 vs apply 期作用域区分，组件命名约定启发式）。

### page-registry

- **C7** `pageBlock()` 收敛为头行拼装（无 params/data JSON 行）+ Markdown 序列化（§3.3 骨架）；`firstScreenData` 的失败态改为交付组件（`useSnapshot()` 收到失败态、渲染为 Markdown），不再拼 JSON 行；交付层把重渲 diff 序列化为 `PAGE-PATCH` 块追加会话历史（§A.6）；
- **C8** 注册面零新建：`apps.register` / `apps.pages(id).register` / `apps.tools(id).define` 照用；新增仅两处——pages.register 接受 PageFC 组件的适配器（内部包成 PageDefinition），以及可选的"渲染快照为 Markdown 文本"入口（供非页面会话注入扩展，首版可不做，§3.5）；
- **C9** 工具动态注册零新建：`ctx.tools.register(defineTool(…))` 照用（会话作用域内调用 + ctx.effect 通道逆序清理）；派发/审批/结果投影全走宿主既有 `tools/*` 管线（§5.4）。

### 测试标准

core 并发安全（"单独跑才过的 spec 是缺陷"）、映射表全标签快照测试、memo/keys/HMR 路径；示范插件走真实 Loader composition（`packages/test-support/loader-smoke`）。

## 8. 迁移与兼容（四阶段）

1. **阶段 1（core 机械）**：C1–C4，行为零变化；
2. **阶段 2（词汇与接入面）**：C5–C6、C8–C9，新旧并存；
3. **阶段 3（示范迁移）**：任务中心三页（附录 A）上线，对照 §10 验收；
4. **阶段 4（退役）**：`pageBlock()` 切换为头行拼装 + Markdown；`Static/Data/Keyed` 退役。

兼容承诺：迁移期旧 `defineAppPage` 照常工作；`description`/`load`/`map` 等元数据不动；§3.9/§3.10 检查语义不变。

## 9. 成本与风险

- core 心脏改造：reconciler 百行级、有界，但测试必须先于合入；
- **Markdown 序列化器是新的正确性关键面**：映射表 + 转义规则 + 未知标签降级，需全标签快照测试（这是 HTML 全集方案最大的新增测试面）；
- 调用序 lint 依赖命名约定（§5.3 代价 2）；
- 首屏纪律（先空后满两帧）需在文档中反复强调。

## 10. 验收标准

1. **WYSIWYG**：未读本 RFC 的新读者只读附录 A 三个组件，能准确复述模型看到的每一行；
2. **内置特殊组件 = 0**：三页演示仅用 HTML 标签 + 四个视图钩子 + `ctx.effect`/`ctx.on`/`ctx.tools.register`；
3. diff 回归：静态骨架永不进补丁；keyed 元素 splice；token 产出不劣化；
4. §3.9/§3.10 检查照常；真机清单第 4/5/7 项（工具作用域互斥、重开摘除、能力地图引用）通过；
5. 事件驱动注入场景可用：`ctx.on` → `await render` → `append(messages/tools)` 成对到场，pageCtx 随会话销毁无泄漏。

## 附录 A：页面实现演示（任务中心三页）

> 示意实现（非最终代码）。领域假设：`ctx.tasks` 提供 `list(status?)` / `get(id)` / `publish({title, desc?})` / `take(id)` / `complete(id, report)` / `abandon(id, reason)`；`Task = { id, title, state, assignee?, desc? }`。

### A.1 任务列表页（入口，`/apps/tasks`）

```tsx
export const TaskListPage: PageFC<{ status?: string }> = (props, ctx) => {
  const [tasks, setTasks] = useState<Task[]>([])
  const reload = () => { ctx.tasks.list(props.status).then(setTasks) }

  ctx.effect(reload)                        // 就绪后取一次（组件拼法的 page:ready）
  ctx.on('tasks/changed', reload)           // 事件驱动失效

  // 动态工具：页面会话作用域内注册——只有本页能接取（Scoped tools shadow globals）
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_take',
    description: '接取任务；taskId 取列表行首的编号',
    parameters: { taskId: { type: 'string' } },        // ParameterSchemaSpec → JSON Schema
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {                         // args 类型由 InferArgs 推导
      await ctx.tasks.take(args.taskId)
      reload()
      return `已接取 ${args.taskId}，责任人变更为当前用户`
    },
  })))

  return (
    <>
      <h1>任务列表{props.status ? ` · ${props.status}` : ''}</h1>
      <p>共 {tasks.length} 条。接取用 task_take；发布去 <a href="/apps/tasks/new">/apps/tasks/new</a>；详情点行首编号。</p>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <strong>{t.id}</strong> <a href={`/apps/tasks/${t.id}`}>{t.title}</a>
            （{t.state} · {t.assignee ?? '未认领'}）
          </li>
        ))}
      </ul>
      {tasks.length === 0 && <blockquote>当前没有任务——如实告知用户，不要编造。</blockquote>}
    </>
  )
}
```

### A.2 任务发布页（工具页，`/apps/tasks/new`）

```tsx
export const TaskNewPage: PageFC = (_props, ctx) => {
  // LLM 没有"表单"：发布即工具调用，本页只教模型怎么填参数
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_publish',
    description: '发布新任务；title 必填、desc 为验收标准（可选），返回任务编号',
    parameters: { title: { type: 'string' }, desc: { type: 'string', required: false } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      const t = await ctx.tasks.publish(args)
      ctx.emit('tasks/changed')
      return `已发布 ${t.id}；详情页 /apps/tasks/${t.id}`
    },
  })))

  return (
    <>
      <h1>发布任务</h1>
      <p>把用户给到的信息整理成参数，调用 task_publish 完成发布。</p>
      <ul>
        <li><strong>title</strong>（必填）：一句话标题</li>
        <li><strong>desc</strong>（可选）：验收标准与上下文</li>
      </ul>
      <blockquote>发布成功后向用户复述任务编号，并建议打开详情页跟进。</blockquote>
    </>
  )
}
```

### A.3 任务详情页（带参只读 + 操作工具，`/apps/tasks/:taskId`）

```tsx
export const TaskDetailPage: PageFC<{ taskId: string }> = (props, ctx) => {
  const task = useSnapshot<Task>()          // meta.load(params) 的首屏结果

  // 操作工具只在本页作用域注册（作用域互斥：列表页看不到 complete/abandon）
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_complete',
    description: '完成任务并回报；report 为结果说明',
    parameters: { report: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      await ctx.tasks.complete(props.taskId, args.report)
      return `已完成 ${props.taskId}`
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_abandon',
    description: '放弃任务；reason 为原因',
    parameters: { reason: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      await ctx.tasks.abandon(props.taskId, args.reason)
      return `已放弃 ${props.taskId}`
    },
  })))

  if (!task) return <p>任务 {props.taskId} 不存在或已删除——如实告知，不要编造。</p>

  return (
    <>
      <h1>{task.id} {task.title}</h1>
      <p>状态 <strong>{task.state}</strong> · 负责人 {task.assignee ?? '未认领'}</p>
      <h2>验收标准</h2>
      <blockquote>{task.desc ?? '（未填写）'}</blockquote>
      <h2>可用操作</h2>
      <ul>
        <li>task_complete：完成后回报结果</li>
        <li>task_abandon：放弃并说明原因</li>
      </ul>
      <hr />
      <p><a href="/apps/tasks">← 返回任务列表</a></p>
    </>
  )
}
```

### A.4 注册（apply——照用既有 ctx.apps 面）

```tsx
export const inject = ['apps', 'pageRegistry', 'tasks'] as const

// 契约面挂在组件旁（适配器包成 PageDefinition 时并入）；map 不手写（§3.5 推导）
const ListMeta = { url: '/apps/tasks', description: '任务列表：浏览/接取任务' }
const NewMeta = { url: '/apps/tasks/new', description: '发布新任务（工具页：挂 task_publish）' }
const DetailMeta = {
  url: '/apps/tasks/:taskId',
  description: '任务详情与操作',
  load: (params: { taskId: string }) => ctx.tasks.get(params.taskId),   // 结果经 useSnapshot() 进组件
}

export const apply = (ctx: Context): void => {
  const apps = ctx.apps
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      done.push(apps.register({ id: APP_ID, name: '任务中心', description: '任务的浏览、发布与跟进', entry: 'list' }, ctx))
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(TaskListPage, ListMeta))
      done.push(pages.register(TaskNewPage, NewMeta))
      done.push(pages.register(TaskDetailPage, DetailMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => undefined
  }, 'tasks-app:wire')
}
```

### A.5 模型实际读到的文档（WYSIWYG 验证）

任务列表页（首帧，`/apps/tasks`）：

```md
PAGE tasks.list /apps/tasks
map:（能力地图——本应用可去的页面；把模板里的 :参数 替换为实际值即为可打开 URL）
- /apps/tasks/:taskId → 看任务详情、完成或放弃
- /apps/tasks/new → 发布新任务
tools: task_take（接取任务；taskId 取列表行首的编号）

# 任务列表

共 3 条。接取用 task_take；发布去 [/apps/tasks/new](/apps/tasks/new)；详情点行首编号。

- **T-1024** [修复登录超时](/apps/tasks/T-1024)（open · 未认领）
- **T-1025** [首页骨架](/apps/tasks/T-1025)（doing · imeep）
- **T-1026** [清理构建脚本](/apps/tasks/T-1026)（done · imeep）
```

任务详情页（`/apps/tasks/T-1024`）——注意 tools 行与列表页不同（作用域互斥）：

```md
PAGE tasks.detail /apps/tasks/T-1024
tools: task_complete（完成任务并回报）、task_abandon（放弃任务）

# T-1024 修复登录超时

状态 **open** · 负责人 未认领

## 验收标准

> 超时时间从 30s 提升到 5s…

## 可用操作

- task_complete：完成后回报结果
- task_abandon：放弃并说明原因

---

[← 返回任务列表](/apps/tasks)
```

### A.6 数据变化 → 消息追加（两条通路）

**通路一：会话内自动补丁（框架固定行为，作者零代码）。** 活页会话里，任何引起快照变化的动作（工具调用、外部事件经 `ctx.on` 刷新）→ 组件重渲 → reconciler diff → 交付层把**发生变化的元素子树**序列化为 `PAGE-PATCH` 块，追加到本会话历史。key 负责对位：模型按行首编号更新对该行的认知。

以列表页会话里模型调用 `task_take { taskId: "T-1024" }` 为例，会话历史依次追加：

```md
[tool result] 已接取 T-1024，责任人变更为当前用户
```

（`ctx.tasks.take` 落库 → store 更新 → 重渲 → diff 出一条变化的 `<li key="T-1024">`）

```md
PAGE-PATCH tasks.list
- **T-1024** [修复登录超时](/apps/tasks/T-1024)（doing · imeep）
```

未变化的行与段落不重发——op 数即 token 预算（§6.1）。

**通路二：跨会话通知（既有投递通路 `deliverUrl`）。** 变化关系到别的会话时，按 URL 幂等投递——活会话追加消息并唤醒，缺席则新建会话（新会话自己完成渲染、挂工具、首帧）：

```tsx
ctx.on('tasks/changed', async (p: { taskId: string; by: string }) => {
  // 会话内发起时带 callerSessionId（投递链深由 HopLedger 管控）；apply 级监听缺席 = 人/宿主
  await ctx.pageRegistry.deliverUrl(`/apps/tasks/${p.taskId}`, {
    message: `[tasks] 任务 ${p.taskId} 已由 ${p.by} 更新，请查看最新状态`,
  })
})
```

非页面会话（纯聊天）的通知走既有 `taskCenter.send` 收件箱通路（TASK 块 + 收件箱文本，真机清单第 6 项验的就是它）。v1 草案的"手工 render 快照 + messages.append"撤销：投递目标若是页面，建会话/唤醒本身就完成渲染。

## 附录 B：与既有平台的 API 对账（2026-10-21 全面审计）

对方案中出现的每一个 API 对照真实包面核查（app-registry / page-registry / dsh-tools / cordis / prompt-page），分三类：

### B.1 既有照用（零新建）

| API | 来源 | 备注 |
| --- | --- | --- |
| `apps.register(definition, ctx)` / `apps.pages(id).register` / `apps.tools(id).define` | `@veren/app-registry` | person-agent-app 正在用同一形状 |
| `ctx.tools.register(def)` | `@deepseek-ai/dsh-tools` | 返回精确 disposer；**调用方 agent 作用域内注册，Scoped tools shadow globals**——工具作用域互斥的原生实现 |
| `defineTool(options): ToolDefinition` | `@deepseek-ai/dsh-tools` | registry-ready；`InferArgs` 推导 execute 的 args 类型 |
| `tools/pre-execute` → `execute` → `post-execute` → `result` / `change` | `@deepseek-ai/dsh-tools` | 派发/审批/结果管线与工具集变化通知全部现成 |
| `ctx.tools.restrict` / `guard` | `@deepseek-ai/dsh-tools` | 作用域限制与守卫，按需白拿 |
| `pageRegistry.deliverUrl(url, { message, wake?, callerSessionId? })` | `@veren/page-registry/delivery` | 按 URL 幂等投递：活会话追加并唤醒，缺席新建；HopLedger 防级联 |
| `taskCenter.send` 收件箱通路 | 既有 | 非页面会话的通知（真机清单第 6 项验证） |
| `ctx.effect(fn, label)` / `ctx.on` / `ctx.extend` / `ctx.emit` | cordis | 收线、事件、子作用域 |
| `pages.register(page, live?: { store })` | `@veren/app-registry` | live store 绑定已存在——`useSnapshot()` 的数据通道有现成挂钩 |
| `PageDefinition` / `ApplicationDefinition` | `@veren/prompt-page` / `@veren/app-registry` | 组件适配器的目标类型 |

### B.2 既有 + 扩展（适配器级）

| 扩展点 | 基座 | 内容 |
| --- | --- | --- |
| `pages.register(PageFC, meta)` | 既有 registrar | 组件适配器：内部把 PageFC + meta 包成 PageDefinition |
| `pageBlock()` 输出格式 | 既有函数 | 去 params/data JSON 行、map 改注册表推导、正文渲染 Markdown |
| `PAGE-PATCH` 块 | 既有 append 交付机制 | 重渲 diff 序列化为 Markdown 的新块类型 |
| `page:ready` / `page:dispose` | cordis 事件系统 | 新增两个 `@mode: emit` 事件声明（命名沿用宿主事件约定，先例 `agent/created`） |

### B.3 确属新造（框架缺口，无法复用）

| 新造 | 归属 | 为什么不能复用 |
| --- | --- | --- |
| hooks 槽位 + render 期 `ctx.effect`/`ctx.on` 记账（C1–C4） | prompt-core | prompt-core 现无 hooks；render 期记账是"React 规则移植"的补完 |
| HTML → Markdown 序列化器（C5） | prompt-page | 平台无服务端 HTML→MD 设施；映射表 + 转义是新的正确性关键面 |
| 渲染期 context 栈（C4） | prompt-core | 组件要读最近 Provider；cordis 的 extend 是作用域不是渲染栈 |
| 调用序 lint（C6） | 工具链 | render 期/apply 期调用区分，React 同款启发式 |

结论：方案的自建面收敛为 **prompt-core 的 hooks/记账内核 + 一个 Markdown 序列化器 + 一个组件适配器**，其余全部是既有平台的照用或薄扩展。
