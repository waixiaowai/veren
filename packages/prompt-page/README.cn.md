# @veren/prompt-page

组件即页面，一次渲染。页面组件在页面会话的真实 DSH Agent 身上执行**恰好一次**，产物即刻成型为 Markdown 进 PAGE 块；此后页面不再渲染——后续变化由页面自己经 `agent.inject` / `agent.followup` 以新消息进上下文。

## 核心契约

```ts
type PageFC<P> = (props: P, agent: Agent) => ElementInput
// 时机：agent/created（建会话即激活），恰好一次
// 返回值：元素树 → Markdown → PAGE 块进上下文
// 体里可直呼：agent.ctx.tools.register / agent.ctx.effect / agent.ctx.on
//   ——体只跑一次，无需任何去重守卫
```

- **props** = URL 参数（`/apps/<appId>/task/:taskId` → `{ taskId }`）
- **agent** = 页面会话的真实 DSH `Agent`，原样不包装：`agent.ctx`（会话作用域，登记随 fiber 生灭）、`agent.session`、`agent.status`、`agent.inject` / `followup` / `steer` / `cancel` 全是真面
- **工具属于页面**：组件体直呼 `agent.ctx.tools.register(definition)`（全名，`<toolPrefix>__<本地名>`），随 agent fiber 生灭；PAGE 块的 tools 行由挂载方取渲染前后工具面快照的**差集**（单一事实源 = 真实登记面）
- **首屏数据**：`meta.load(params, env)` 建会话时跑一次，结果经 `useSnapshot()` 进组件（失败态也是数据，如实渲染）
- **禁止二次渲染**：没有 fiber、没有调和器、没有 PAGE-PATCH、没有槽位记账。页面的视觉呈现即 PAGE 块本身；数据变化 = 新消息

## 写一个页面

```tsx
/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'

const DetailPage: PageFC<{ taskId: string }> = (props, agent) => {
  // 工具直登（跑一次，安全；全名即对外名）
  agent.ctx.tools.register({ name: 'demo__read', /* ToolDefinition */ } as never)
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

```ts
const pages = apps.pages(APP_ID, ctx)
pages.register(DetailPage, DetailMeta)
```

## 运行时序（挂载即全部）

1. `openUrl(url)` → 旧会话废弃（agent 退役，登记随 fiber 拆除）
2. 建会话 + 当场激活 agent（agent/created）+ 页面作用域屏蔽（app_open/app_list/app_pages 的 deny）
3. `meta.load` 首屏取数（10s 超时 → 失败态）
4. **唯一一次渲染**：组件体在真实 agent 上执行；工具/skills/订阅/清理此刻登记
5. PAGE 块（定位行 + 能力地图 + tools 差集行 + 应用/页面说明 + 正文）进会话
6. 任务接取块、收件箱通知、focus——照常

## 设计律

1. **一个会话一次渲染**：渲染结果进上下文后不再改变；变化 = 新消息（页面经 `agent.inject` 自己推）。要"再渲染"，重开 URL = 新会话
2. **页面实例与 agent 共存亡**：agent 生则渲染；agent 死则登记尽拆。没有"没 agent 的渲染"——那在类型上就不可表示
3. **工具只在页面存在**：无应用级目录清单、无 meta.tools 间接层。页面 body 的登记就是页面的全部工具面
4. **misconfiguration fails loud**：声明 `writes: true` 的详情页登记差集为零 → 挂载期拒绝；agent 缺席 → 挂载期拒绝；没有回退形态

## API 速览

| 出口 | 用途 |
| --- | --- |
| `defineComponentPage(component, meta)` | PageFC + meta → `{ page, live }`（注册面收的形状） |
| `PageFC<P>` | `(props, agent) => ElementInput`——页面组件契约 |
| `useSnapshot<T>()` | 读 `meta.load` 的首屏结果（含失败态；挂载之外 undefined） |
| `isComponentPageRegistration(value)` | 注册面检测标记 |
| `definePage` / `defineAppPage` | 契约校验入口（URL 形态、规则 3 说明半边） |
| `pageToolWarning(page, mountedCount)` | §3.9 完备性警告（挂载期判据） |
| `elementsToMarkdown(input)` | 元素树 → Markdown（§3.2 映射，WYSIWYG） |

## 更详细的文档

- 设计全集（RFC prompt-page-render）：`docs/prompt-page-render-design.md` / `.cn.md`
- page-registry（打开/索引/投递运行时）：`plugins/page-registry/README.cn.md`
- app-host（装配/网关/会话端口）：`plugins/app-host/README.cn.md`
