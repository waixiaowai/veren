# Page-Sync Core（页面同步内核）

[English](./README.md) | 中文

## 是什么 / 何时用

面向 LLM 页面会话的通用"虚拟 prompt 树"同步内核——把 React reconciliation 模型应用到只追加的模型上下文：`render(模板, state) → 树 → diff → ops → 字节稳定消息 → append`。插件需要缓存友好的增量上下文更新（列表页/详情页/事件流）时使用。不要把业务逻辑放这里；领域插件自己持有状态与按钮，消费本内核。

## 概念

- **PromptNode 五种节点**：`static`（永不 diff，memo）/ `field`（set op）/ `keyed`（key-diff → splice）/ `log`（只追加）/ `group`（递归 diff，引用相等整棵 bail out）。
- **四种 op**：`set` / `remove` / `splice` / `append` —— 三种语义覆盖全部页面原型。
- **PageStore**：`update()`（diff+commit 合批）、`stage()`/`flush()`（background lane 攒批）、`sync(cursor)`（增量优先，缺口/无基线回落全量）、`anchor()`（压实）。
- **字节稳定**：`canonicalJson` 对象键字典序；消息信封（`PATCH vA->vB {ops}` / `SNAPSHOT vN {nodes}`）模板固定，未变的模板字节持续吃缓存。

## 不可变纪律（重要）

`diffNodes` 按引用相等 bail out（React memo 语义）。如果原地修改上一棵树仍引用的数组/对象，diff 会认为"没有变化"而产出零 op。给 `PageStore.update()` 传发生变化的数据时必须传新副本——交给内核的每一棵树都要当成不可变快照。

## 运行

```bash
pnpm --filter @veren/page-sync-core test
```

第一个消费方：`plugins/page-sync-bench`（真实 API 验证缓存命中率、工具成功率、token 消耗）。
