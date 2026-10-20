# Prompt Core（调度内核）

[English](./README.md) | 中文

## 是什么 / 何时用

面向 LLM prompt 流的 React 式 reconciler 内核——本架构中的 `react`。用它把页面写成函数组件，diff 自动变成只追加的上下文副作用。它不知道任何消息格式与 LLM provider；与 `@veren/prompt-host-messages`（`react-dom` 对应物）配套使用。不要放业务逻辑——领域 store 与按钮属于消费方。

## 概念 → React 映射

| prompt-core | React | 说明 |
|---|---|---|
| `createElement(type, props)` | 同名 | `key` 从 props 提升；对象冻结 |
| `Component` `(props) => PromptElement[]` | 函数组件 + Fragment | 返回数组即 Fragment |
| `memo(component, areEqual?)` | 同名 | 默认 canonical 比较 → 整棵子树 bail out，零 effect |
| `reconcileChildren` | fiber diff | 同位同型 → update；异型 → 重建；keyed 元素跨位对位 |
| `scheduleRender(root, elements, lane)` | render+commit | render 阶段纯函数可丢弃；commit 经宿主原子提交 |
| `lane: sync / transition / background` | lanes | background 先入 `root.pending`，随 sync commit 或 `flushBackground` 落盘 |
| `bindStore(root, store, mapState)` | `useSyncExternalStore` | 权威外部 store → 重渲染 → 提交 |

## 不可变纪律

effect 通过 `canonicalJson`（键字典序）比较 props/内容产出；fiber 按引用相等 bail out（memo 语义）。重渲染前必须用新副本替换变化的数据——原地修改上一棵树的数据会让 diff 认为"没有变化"。

## 运行

```bash
pnpm --filter @veren/prompt-core test
```
