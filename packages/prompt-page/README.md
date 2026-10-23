# @veren/prompt-page

组件即页面，一次渲染。页面组件在页面会话的真实 DSH Agent 身上执行**恰好一次**，产物即刻成型为 Markdown 进 PAGE 块；此后页面不再渲染——后续变化由页面自己经 `agent.inject` / `agent.followup` 以新消息进上下文。

A component IS the page, rendered once. The page component runs **exactly once** on the page session's real DSH Agent; its output is immediately finalized into the Markdown PAGE block. The page never renders again — later changes reach the context as new messages the page pushes itself via `agent.inject` / `agent.followup`.

## 核心契约 / The core contract

```ts
type PageFC<P> = (props: P, agent: Agent) => ElementInput
// 时机 / timing：agent/created（建会话即激活），恰好一次 / exactly once
// 返回值 / return：元素树 → Markdown → PAGE 块进上下文
// 体里可直呼 / in the body：agent.ctx.tools.register / agent.ctx.effect / agent.ctx.on
//   ——体只跑一次，无需任何去重守卫 / the body runs once, no dedup guards needed
```

- **props** = URL 参数（`/apps/<appId>/task/:taskId` → `{ taskId }`）
- **agent** = 页面会话的真实 DSH `Agent`，原样不包装：`agent.ctx`（会话作用域，登记随 fiber 生灭）、`agent.session`、`agent.status`、`agent.inject` / `followup` / `steer` / `cancel` 全是真面
- **工具属于页面**：组件体直呼 `agent.ctx.tools.register(definition)`（全名，`<toolPrefix>__<本地名>`），随 agent fiber 生灭；PAGE 块的 tools 行由挂载方取渲染前后工具面快照的**差集**（单一事实源 = 真实登记面）
- **首屏数据**：`meta.load(params, env)` 建会话时跑一次，结果经 `useSnapshot()` 进组件（失败态也是数据，如实渲染）
- **禁止二次渲染**：没有 fiber、没有调和器、没有 PAGE-PATCH、没有槽位记账。页面的视觉呈现即 PAGE 块本身；数据变化 = 新消息

- **props** are the url params (`/apps/<appId>/task/:taskId` → `{ taskId }`)
- **agent** is the page session's real DSH `Agent`, verbatim and unwrapped: `agent.ctx` (the session scope; registrations live and die with the fiber), `agent.session`, `agent.status`, `agent.inject` / `followup` / `steer` / `cancel` — all real
- **Tools belong to the page**: the body calls `agent.ctx.tools.register(definition)` directly (full names, `<toolPrefix>__<local>`); they live and die with the agent fiber. The PAGE block's tools line is the **delta** of tool-face snapshots around the render (the single source of fact is the real registration face)
- **First-screen data**: `meta.load(params, env)` runs once at session creation; the result reaches the component via `useSnapshot()` (failure states are data too, rendered honestly)
- **No second render**: no fibers, no reconciler, no PAGE-PATCH, no slot bookkeeping. The page's visual presence IS the PAGE block; a data change is a new message

## 写一个页面 / Authoring a page

```tsx
/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import { APP_ID } from './app.ts'

const DetailPage: PageFC<{ taskId: string }> = (props, agent) => {
  // 工具直登（跑一次，安全；全名即对外名）
  // / register tools directly (run once, safe; the full name is the external name)
  agent.ctx.tools.register({ name: `${APP_ID.value ?? 'demo'}__read`, /* defineTool 形状的 ToolDefinition */ } as never)
  const snap = useSnapshot<{ title: string }>()
  return <h1>{snap?.title ?? '未知'}</h1>
}

const DetailMeta: ComponentPageMeta<{ taskId: string }> = {
  url: '/apps/demo/task/:taskId',
  description: '任务详情页',
  writes: true,
  instructions: '只处理 params.taskId 指定的这一条任务。',
  load: async (params, env) => fetchTask(params.taskId, env.preset),
  instanceTitle: (params) => `任务 #${params.taskId}`,
}
```

注册走应用单入口（app-registry 内部镜像进 page-registry）：

Registration rides the app's single entry (app-registry mirrors into page-registry internally):

```ts
const pages = ctx.apps.register(APP_DEFINITION, ctx) && apps.pages(APP_ID, ctx)
pages.register(DetailPage, DetailMeta)
```

## 运行时序（挂载即全部）/ Runtime order (the mount is everything)

1. `openUrl(url)` → 旧会话废弃（agent 退役，登记随 fiber 拆除）
2. 建会话 + 当场激活 agent（agent/created）+ 页面作用域屏蔽（app_open/app_list/app_pages 的 deny）
3. `meta.load` 首屏取数（10s 超时 → 失败态）
4. **唯一一次渲染**：组件体在真实 agent 上执行；工具/skills/订阅/清理此刻登记
5. PAGE 块（定位行 + 能力地图 + tools 差集行 + 应用/页面说明 + 正文）进会话
6. 任务接取块、收件箱通知、focus——照常

1. `openUrl(url)` → the previous session is deprecated (its agent retires; registrations unwind with the fiber)
2. create the session, activate the agent right away (agent/created), apply the page-scope masking (the app_open/app_list/app_pages deny)
3. `meta.load` fetches the first screen (10s timeout → failure state)
4. **the only render**: the body runs on the real agent; tools/skills/subscriptions/cleanups register now
5. the PAGE block (locator + capability map + tools-delta line + app/page notes + body) enters the session
6. task blocks, inbox notices, focus — as usual

## 设计律 / Design laws

1. **一个会话一次渲染**：渲染结果进上下文后不再改变；变化 = 新消息（页面经 `agent.inject` 自己推）。要"再渲染"，重开 URL = 新会话
2. **页面实例与 agent 共存亡**：agent 生则渲染；agent 死则登记尽拆。没有"没 agent 的渲染"——那在类型上就不可表示
3. **工具只在页面存在**：无应用级目录清单、无 meta.tools 间接层。页面 body 的登记就是页面的全部工具面
4. **misconfiguration fails loud**：声明 `writes: true` 的详情页登记差集为零 → 挂载期拒绝；agent 缺席 → 挂载期拒绝；没有回退形态

1. **One session, one render**: the output enters the context and never changes; a change is a new message (the page pushes it via `agent.inject`). To "render again", reopen the url = a fresh session
2. **The page instance and its agent share fate**: the agent is born → the render runs; the agent dies → every registration unwinds. There is no "render without an agent" — it is unrepresentable at the type level
3. **Tools exist only inside a page**: no app-level catalog manifest, no meta.tools indirection. The body's registrations ARE the page's whole tool face
4. **Misconfiguration fails loud**: a `writes: true` detail page whose registration delta is empty is refused at mount; a missing agent is refused at mount; there is no fallback shape

## API 速览 / API surface

| 出口 / export | 用途 / purpose |
| --- | --- |
| `defineComponentPage(component, meta)` | PageFC + meta → `{ page, live }`（注册面收的形状）/ wraps a PageFC into the registrable shape |
| `PageFC<P>` | `(props, agent) => ElementInput`——页面组件契约 / the page component contract |
| `useSnapshot<T>()` | 读 `meta.load` 的首屏结果（含失败态；挂载之外 undefined）/ reads meta.load's first-screen result (failures included; undefined outside a mount) |
| `isComponentPageRegistration(value)` | 注册面检测标记 / the registration-face marker |
| `definePage` / `defineAppPage` | 契约校验入口（URL 形态、规则 3 说明半边）/ contract validation entries (url shape, rule 3's instructions half) |
| `pageToolWarning(page, mountedCount)` | §3.9 完备性警告（挂载期判据）/ the §3.9 coverage warning (judged at mount) |
| `elementsToMarkdown(input)` | 元素树 → Markdown（§3.2 映射，WYSIWYG）/ the element tree → Markdown (the §3.2 mapping, WYSIWYG) |

## 更详细的文档 / Further reading

- 设计全集（RFC prompt-page-render）：`docs/prompt-page-render-design.md` / `.cn.md`
- page-registry（打开/索引/投递运行时）：`plugins/page-registry/README.md`
- app-host（装配/网关/会话端口）：`plugins/app-host/README.md`
