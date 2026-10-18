# @deepseek-ai/dsh-graph-flow-canvas-node-echo

最小化的独立 DSH 客户端插件：为 Flow 画布面板的 `echo` 节点类型注册一个自定义渲染器。
它的存在是为了证明面板的 `flow.canvas.node` 扩展点：装上后演示里的两个 echo 节点会切换成
一张明显不同的卡片；卸载或禁用后回落到面板默认卡片。注册归插件 fiber 所有，HMR 安全。

## 安装

需要同一 profile 里已装画布面板。然后：

```powershell
pnpm --dir packages/graph/flow-canvas-node-echo pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-node-echo-0.1.5.tgz
```

重启 `dsh web`（或禁用该插件行）并重新打开面板。演示里的两个 `echo` 节点（`recover` 与
`normal`）使用自定义卡片，其他节点类型保持默认卡片。

## 贡献内容

- 一个语言命名空间（`flowCanvasEcho`），含中英两份词典。
- 一个 keyed 注册：`ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({ name: 'flow.canvas.node', key: 'echo', locale: NS }, EchoNode))`。
- 没有宿主代码、没有传输、没有状态：这是最小的有效扩展。

卡片接收槽位 owner props —— `node`、`runtime`、`selected`、`onSelect` —— 展示节点实时状态
和一个标识「扩展渲染」的徽标。

## 测试

```powershell
pnpm --dir packages/graph/flow-canvas-node-echo test
```

测试在真实槽位注册表上挂载插件，断言 `echo` 注册随 fiber 出现与消失（HMR），并断言两份
词典键集合一致。
