# 流程画布 UI/交互重构

日期：2026-10-18 · 面板 `0.1.11` · echo 演示 `0.1.3`

> 后续的节点卡片视觉打磨与边界修复（`0.1.13`）见
> [`ui-cards.cn.md`](ui-cards.cn.md)；本文只覆盖布局/交互这一轮。

这是一次 `packages/graph/flow-canvas-panel` 的交互与布局重构，不是换配色。数据面、只读契约、
授权生命周期、keyed 节点渲染槽位与刷新恢复全部保持不变，并由同一套测试覆盖。

## 目标

用过 n8n / Dify / Coze 的人，不看文档也应能完成：

**选流程 → 运行 → 看出哪个节点在跑、哪里等待人、哪里失败 → 点节点看输出 → 有授权就点同意。**

面板以中文为先。宿主 id（节点标签、工具名、错误码、部署提供的授权原因）保持原样；
所有产品自有的界面文案都已本地化。

## 改前 / 改后

两组截图都是 1440×900、同一批 flow、在隔离节点中截取。改前是上一版 `0.1.10`，改后是 `0.1.11`。

| 改前 | 改后 |
|---|---|
| ![改前：面板初始](ui-before/before-panel-initial.png) | ![改后：面板初始](ui-after/after-panel-initial.png) |
| ![改前：运行结束](ui-before/before-settled.png) | ![改后：运行结束](ui-after/after-settled.png) |
| ![改前：节点 output](ui-before/before-output.png) | ![改后：节点 output](ui-after/after-output.png) |
| ![改前：授权卡](ui-before/before-approval-card.png) | ![改后：授权坞](ui-after/after-approval-card.png) |
| ![改前：同意后](ui-before/before-approval-approved.png) | ![改后：同意后](ui-after/after-approval-approved.png) |

补充证据：

- `ui-after/after-reload-resumed.png`：整页刷新后挂起授权仍在，之后完成同一运行。
- `ui-after/after-zoom-fit.png`：放大把 105% 变成 126%，**适应屏幕**恢复到 105%。

## 毛病 → 改动

| 毛病 | 改法 | 主要文件 |
|---|---|---|
| 画布只占中间竖带，右侧四分之一常年空白。 | 改成**从左到右**的分层布局（n8n / Dify / Coze 的习惯），画布视口占满主体；右侧详情只在选中节点时出现，初始画布拿到全部宽度。 | `layout.ts`、`FlowGraph.tsx`、`Panel.tsx`、`panel.module.css` |
| 卡片又大又重复。 | `176×68` 紧凑卡片：状态图标+短词、节点标签、可读类型徽标、一行截断详情。策略、重试/超时、耗时、完整错误与授权审计收进详情面板。 | `DefaultNodeCard.tsx`、`Inspector.tsx`、`panel.module.css` |
| 边标签压在线上、互相叠、离节点太近。 | 简短中文胶囊标签（`出错分支`、`默认分支`）、箭头、按目标位置排序的扇出，以及避开节点与其他标签的摆放。 | `layout.ts`、`FlowGraph.tsx`、`model.ts` |
| `运行中…` 像按钮；`刷新` 像重载页面；flow 下拉是内部 id。 | 运行是主操作；运行中换成**取消运行**，状态放进状态条。刷新改为**刷新列表**并带解释 tooltip。flow id 映射为可读中文名（原始 id 留在 option title）。 | `Panel.tsx`、`StatusStrip.tsx`、`present.ts`、`locales.ts` |
| 状态行是一串数字，失败/授权不突出。 | 运行状态胶囊 + 琥珀色**「N 个节点等待授权」**和红色**「N 个节点失败」**按钮，点一下打开对应节点；完成计数变成右侧安静的 chip。 | `StatusStrip.tsx`、`present.ts` |
| 授权卡浮在节点/边上，按钮偏小。 | 画布上方全宽**授权坞**（永不盖图）：工具/动作、所属节点、参数要点、原因、请求时间、实时自动拒绝倒计时，44px 主按钮**同意**与次按钮**拒绝**。回答后授权坞留在原处报告结果（含谁/何时），直到收起。 | `ApprovalDock.tsx`、`NodeApprovalCard.tsx`、`panel.module.css` |
| 中英混杂。 | 中文优先词典；flow 名、节点类型、跳过原因、失败策略、运行状态都有可读中文。宿主数据按设计保持原样。 | `locales.ts`、`present.ts`、`demo.ts` |
| 没有平移/缩放/适应屏幕，选中不明确，详情不自动打开。 | 拖拽平移、滚轮以光标缩放、缩小/重置/放大/**适应屏幕**。选中节点有描边；点击打开详情，等待授权的节点自动打开详情，点空白取消选中。 | `FlowGraph.tsx`、`view.ts`、`Panel.tsx` |
| 高频动作层级一致，没有主次。 | 顶栏一个动作簇：流程选择 → 主按钮运行 → 次按钮取消 → ghost 刷新列表。 | `Panel.tsx`、`panel.module.css` |

关于第 8 条“点节点后右侧详情没打开”：**无法复现**。点击节点本来就会打开详情；真正的缺口是
详情列永远占位、等待授权时不会自动打开、以及选中缺少反馈。这三处已经修掉，点击路径由 jsdom
端到端测试覆盖。

## 保留的能力

- 授权等待 / 同意 / 拒绝 / 超时 / 取消，仍走同一条一次性、按 run 隔离的 Remote 路径。
- `flow.canvas.node` keyed 渲染槽位与默认卡片回落，owner props 里的 `pendingApproval`、
  `approvals`、`onApprovalDecision` 不变。
- 整页刷新恢复：列表、选中 flow 与 `runId` 恢复后重新订阅同一运行，绝不新开运行。
- 只读投影：面板不写内核；output 只从 `snapshot.result.nodes[id].output` 读取。

## 验证

- 类型检查：面板与 echo 包均无诊断。
- 测试：graph 12 个包共 **230 spec** 全绿；面板包 **58** 条（状态/视口/布局/名称/待处理/
  output/store/刷新/槽位，以及 jsdom 端到端）。
- 真实浏览器：临时隔离节点（自有 `DSH_HOME` 与 pnpm store，端口 3099；验证后已清理），
  装 graph bundle + 面板 `0.1.11` + echo `0.1.3` + 授权夹具。无头 Chrome 在 1440×900
  下走：放大 → 适应屏幕 → 拖拽平移；选流程 → 运行；等待授权坞 → 同意；点节点看 output；
  授权挂起时整页刷新 → 完成同一运行。`docs/e2e-ui.mjs` 可复跑。
- 没有修改 3080 与 `~/.dsh`。

## 故意没做

- 不做拖拽编辑、新建节点、多选、复制粘贴、撤销。
- 不做小地图，不持久化布局/视口。
- 不做运行历史；取消按钮只作用于当前运行。
- 不展示谓词表达式文本（投影只有摘要）。
- 不做一次放行全部/长期授权。
- 不做面向部署的 flow 注册界面。

## 第一次使用的人能不能走通（只放一处真话）

用过流程编辑器的人不用文档能走通：flow 下拉可读，蓝色“运行”是明确主操作，状态条会说谁在等，
琥珀色授权坞把决定摆在眼前，点节点就能看到 output。剩下的英文是宿主数据（`start`/`gate` 等
节点 id、`flow-approval-demo` 等工具名、错误码、部署提供的授权原因）——界面故意不改写它们。

一个取舍：在六节点图上打开 348px 的详情面板时，图比剩余视口宽，右边缘可能被裁掉。选中节点
始终在视野内，**适应屏幕**或关掉详情即可看到整图。我们没有选择“一开详情就把整图缩小”，
那样节点文字会小到不可读。
