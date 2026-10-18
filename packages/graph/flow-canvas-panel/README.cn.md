# @deepseek-ai/dsh-graph-flow-canvas-panel

标准 DSH 客户端插件：在 Web GUI 里以只读、可点击的画布展示已注册的 graph flow。
它占据整块 `main` 面板并提供侧栏入口，通过 `flowCanvas` Remote 命名空间暴露画布数据源，
实时接收节点状态，并按公开契约打开节点 output。

本插件取代被否决的独立页面（`packages/graph/flow-canvas-ui`，4780 端口），成为受支持的
画布界面；数据面公开 API 不变，本版在 `graph-core`、`flow-engine`、`flow-canvas` 修了
一个生命周期问题：Remote 调用的瞬态 Cordis context 不再吞掉 `graph/node-status` 事件。

## 前置条件

- DSH Web profile 已装 graph bundle（`@deepseek-ai/dsh-graph-bundle`），从而存在
  `graphFlowCanvas`、`graphFlowEngine` 与 `graphFlowApproval` 服务。请从本仓库重新打 bundle，
  才能带上 owner-context 生命周期修复与新授权服务。
- 构建需要 DSH 检出仓库（与本仓库同级的 `deepseek/deepseek-harness`），
  本包用其 `clientBundle` 预设产出浏览器工件。

## 装进 profile

在仓库根目录把面板 tarball 装进目标 profile。目标 profile 必须已经带上本仓库的
graph bundle（以**目录依赖**安装，因为 pnpm 以 profile 根解析 bundle 内的 `file:` 嵌套
tarball；不要把 bundle 当单个 tarball 安装）：

```powershell
$env:DSH_HOME = 'C:\path\to\your\test-node'   # 千万不要误指向 ~/.dsh
pnpm --dir packages/graph/flow-canvas-panel pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-panel-0.1.13.tgz
```

bundle 目录在 `packages/graph/bundle`；隔离测试节点的
`profiles/web/pnpm-workspace.yaml` 展示了固定的 overrides（`graph-core`、`flow-engine`、
`flow-canvas`、`@veren/core`、`@veren/yaml-parser` 以及 graph 家族其余包）。

可选的演示渲染器扩展：

```powershell
pnpm --dir packages/graph/flow-canvas-node-echo pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-node-echo-0.1.5.tgz
```

安装后重启 `dsh web`，在侧栏点 **Flow 画布**。宿主会在演示 flow 缺失时注册三个真实 flow
（`canvas-demo`、`canvas-demo-pacing`、`canvas-demo-predicate`），让新 profile 有图可看；
部署自己注册的 flow 也会出现在同一个选择器里。

装进用户正在用的 3080 桌面 profile 时，用 `--profile desktop` 和
`C:\Users\imeep\.dsh`，但必须等桌面端完全退出后再执行；该 profile 里要先有 graph bundle
目录及其 overrides。桌面进程运行期间，本仓库不会写 `~/.dsh`。

## 面板能力

- **画图与浏览**：分层从左到右布局（n8n / Dify / Coze 的习惯）、带箭头且从可见端口进出的
  贝塞尔边、简短中文分支标签（`出错分支`、`默认分支`），以及 `184×72` 卡片：类型图标、
  唯一的状态色条 + 状态词、一行安静的副标题。目标未执行的边是弱化点线；error 默认边仍是虚线。
  完整视觉规则见 [`docs/ui-cards.cn.md`](docs/ui-cards.cn.md)。
  画布占满面板：拖拽平移、滚轮以光标为锚点缩放，控件提供缩小 / 重置 / 放大 / **适应屏幕**。
  布局归浏览器所有，投影的 layout 槽位保持为空。
- **真实运行**：「运行」调用 `flowCanvas/run` 再 `flowCanvas/subscribe`；节点状态实时更新：
  失败红、`完成 · 已兜底` 琥珀、跳过灰并显示原因，未开始节点弱化。运行中「运行」换成「取消运行」。
- **状态条直指下一步**：运行状态胶囊之外，等待授权是琥珀色按钮、失败是红色按钮，
  点一下直接打开对应节点；完成计数安静地放在右侧。
- **整页刷新可续**：首个订阅者自动加载列表（连接未就绪时重试），选中的 flow 与 `runId`
  存在 `sessionStorage`。F5 / Ctrl+R 后按同一 `runId` 重新订阅，状态从宿主投影继续推进，
  不会新开一次运行。多订阅者互不干扰：某个流结束绝不 dispose 共享投影。
- **点节点看 output**：点节点打开右侧检查器，显示可读类型、状态、策略、重试/超时、耗时、
  错误、授权审计与 `snapshot.result.nodes[id].output`。挂起授权所属的节点也会自动选中，
  检查器与授权坞讲同一件事。画布运行时记录从不携带 output；缺失会解释原因。
- **画布上方的授权坞**：工具节点（或任何调用 `nctx.approval.request` 的节点类型）需要授权时，
  节点进入 `awaiting-approval`，画布在**图的上方**展开全宽琥珀色授权坞，而不是盖住图：
  工具/动作、所属节点、参数要点、为什么、请求时间、实时倒计时，以及两个回答——
  大号主按钮「同意」与次按钮「拒绝」。回答后授权坞留在原处报告结果（含谁/何时），
  直到用户收起。同意 → 工具继续、节点完成；拒绝 → `NODE_PERMISSION_DENIED`；
  超时 → `NODE_APPROVAL_TIMEOUT`；取消运行 → 挂起撤销。
- **按节点类型扩展**：页面声明 keyed `flow.canvas.node` 槽位，按 `node.type` 分发，
  未注册的 key 回落默认卡片。第三方插件按 key 注册渲染器；卸载回落，HMR 安全。
  owner props 里带 `pendingApproval`、`approvals` 与 `onApprovalDecision`，所以自定义渲染器
  可以只用自己的 UI 请求/回答授权；面板也导出可复用的 `NodeApprovalCard`。

## 扩展点示例

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-graph-flow-canvas-panel/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('myNodes', {
    zh: { badge: '自定义' },
    en: { badge: 'custom' },
  }), 'my-nodes: dictionaries')
  ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({
    name: 'flow.canvas.node',
    key: 'echo',                 // 该渲染器认领的节点类型
    locale: 'myNodes',
  }, MyNode))
}

function MyNode({ node, runtime, selected, onSelect, pendingApproval, onApprovalDecision, t }:
  PropsRuntime<'flow.canvas.node'> & PropsLocale<'myNodes'>) {
  return (
    <div>
      <button type="button" aria-pressed={selected} onClick={() => onSelect(node.id)}>
        {t('badge')} · {node.display.label} · {runtime?.status ?? 'pending'}
      </button>
      {pendingApproval === undefined ? null : (
        <button type="button" onClick={() => onApprovalDecision(pendingApproval.request.id, 'allow')}>
          allow {pendingApproval.request.action}
        </button>
      )}
    </div>
  )
}
```

`pendingApproval` 是当前挂起请求；`approvals` 是含结果的完整审计；`onApprovalDecision`
走与内置卡片相同的单次、按 run 隔离的 Remote 路径。有宽裕空间的自定义渲染器（自己的面板或
详情区）可以直接复用
`import { NodeApprovalCard } from '@deepseek-ai/dsh-graph-flow-canvas-panel/client'`；
`184×72` 的节点卡片应使用自己的紧凑授权 UI。

配套包 `@deepseek-ai/dsh-graph-flow-canvas-node-echo` 就是针对 `echo` 类型的这份实现，
用来测试扩展点真实生效。

## 宿主面

`src/index.ts` 挂载名为 `flowCanvasController`、命名空间为 `flowCanvas` 的
`TypertRemoteService`：

| 端点 | 形状 |
|---|---|
| `flowCanvas/list` | `{ flows: FlowSummary[] }` |
| `flowCanvas/project` | 某个已注册 flow 的 `CanvasFlow` |
| `flowCanvas/run` | `{ runId, flowId, snapshot }` |
| `flowCanvas/answer` | `{ runId, requestId, decision: 'allow' \| 'deny', actor? }` → `{ ok: true }`；一次性、按 run 隔离 |
| `flowCanvas/cancel` | `{ runId }` → `{ ok: true }`；撤销挂起授权 |
| `flowCanvas/subscribe` | `{ type: 'snapshot' \| 'change', ... }` 流 |

宿主只调用画布公开 API（`project`、`run`、`snapshot`、`subscribe`、`finished`）、引擎的
`listFlows` 与授权服务的 `answer`，从不转发内核事件。运行投影按 `runId` 保留，运行中重新打开面板仍可订阅。

## 明确不做

- 不提供 flow 编辑、拖拽、多选、小地图、布局持久化。
- 不展示谓词表达式文本（投影只有摘要）。
- 没有运行历史；取消按钮只作用于当前运行。
- 没有长期授权/一次放行全部：每次授权只对当前 run 的当前调用有效。
- 没有面向部署的 flow 注册界面；部署仍用 `FlowEngine.registerFlow` 或 YAML Loader。
- 浏览器 contribution 为手工构造（与其他仓库外插件一致），因为 Typert 生成器要求
  属于 DSH 工作区；宿主方法与线缆 codec 按生成形状编写。

## 验证

当前界面在一个临时隔离节点（自有 `DSH_HOME` 与 pnpm store，端口 3099；验证后已清理；
全程没有碰 3080）的真实 Web GUI 中验证：graph bundle + 面板 0.1.13 + echo 0.1.5 +
仅测试用的授权夹具。布局轮与首次使用判断见
[`docs/ui-refactor.cn.md`](docs/ui-refactor.cn.md)；节点卡片视觉规则见
[`docs/ui-cards.cn.md`](docs/ui-cards.cn.md)。`docs/e2e-ui.mjs` 用无头 Chrome 在
1440×900 下走完整路径：放大 → 100% → 适应屏幕 → 拖拽平移，选流程 → 运行，
等待授权坞 → 同意，点节点看 output，再在授权仍挂起时整页刷新并完成同一运行；
同时截取深色主题。`docs/e2e-borders.mjs` 专门检查卡片轮廓：浅色/深色下的 82% 与
100%、hover 与选中态，并记录计算后的描边/阴影。运行方式：

```powershell
node docs/e2e-ui.mjs <web-url> after docs/ui-card-after
node docs/e2e-borders.mjs <web-url> after docs/ui-borders-after
```

卡片 `before` 来自同一批 flow、同一分辨率下的上一版 0.1.11（`docs/ui-card-before`，
从上一轮的 `ui-after` 复制）；0.1.10 的布局前后对比仍保留在 `docs/ui-before` 与
`docs/ui-after`。

| 改前（0.1.11） | 改后（0.1.13） |
|---|---|
| ![改前：运行结束](docs/ui-card-before/after-settled.png) | ![改后：运行结束](docs/ui-card-after/after-settled.png) |
| ![改前：等待授权](docs/ui-card-before/after-approval-card.png) | ![改后：等待授权](docs/ui-card-after/after-approval-card.png) |
| ![改前：选中 output](docs/ui-card-before/after-output.png) | ![改后：选中 output](docs/ui-card-after/after-output.png) |
| ![改前：同意后](docs/ui-card-before/after-approval-approved.png) | ![改后：同意后](docs/ui-card-after/after-approval-approved.png) |

补充证据：`docs/ui-card-after/after-zoom-100.png`（100% 可读性）、`after-zoom-in.png`
（126%）、`after-dark-settled.png` 与 `after-dark-approval.png`（宿主深色主题）、
`after-reload-resumed.png`（整页刷新后挂起授权仍在）。旧的 `shot-*.png` 与
`approval-*.png` 作为 0.1.10 界面的历史截图保留。

## 测试

```powershell
pnpm --dir packages/graph/flow-canvas-panel test
pnpm --dir packages/graph/flow-canvas-node-echo test
pnpm --dir packages/graph/flow-canvas test
```

面板测试覆盖状态/边映射、视口数学（适应/以光标缩放/保持可见）、横向布局与标签避让、
可读名称查表、待处理队列、output 契约、store 的 Remote 边界、冷列表重试、刷新续订、
多订阅者所有权、槽位注册与卸载，以及 jsdom 端到端：挂真实渲染器、跑演示 flow、
自动打开挂起授权的节点详情、经 Remote 回答授权、读 output，并证明按类型覆盖与卸载回落。
卡片专项断言检查每张默认卡片恰好一个类型图标/一个状态色条、每条边两端都有端口、
两条跳过分支为点线。`flow-canvas` 另有一条回归：从瞬态子 context 启动运行仍能收到实时节点事件。
graph 12 个包当前共 230 条 spec 通过（面板 58，echo 2）。
