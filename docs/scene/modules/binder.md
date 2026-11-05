---
title: 绑定器（Binder）
description: "维护组合↔会话绑定行：首次进门按预装配创建专属会话，再进原样恢复，解绑拆除房间；在途回合后台继续。"
sidebar:
  order: 4
  label: 绑定器
draft: false
lastUpdated: 2026-11-05
---

## 1. Responsibility

绑定器管房间的钥匙：每个组合（场景×预设）一条绑定行，指向它的专属会话。首次进门以组合的预装配创建会话，之后再进原样恢复；解绑拆除房间。它与相邻模块的分界：它不做任何判定（判定器的事），也定义不了记忆的语义（场景记忆的事）；它只保证——**每个组合稳定对应一个会话，激活即恢复，损坏即响亮失败**。

**外围定位**：绑定行机制复用宿主既有的「键→会话」绑定模式（应用页面存储域已实践同款），本章只定义场景维度的键与语义，不新造存储。

## 2. Features

- 绑定查找：按组合键查绑定行，得到专属会话。
- 首次进门：无绑定行时，按组合的预装配（工具、技能、人格段落）创建专属会话，写入绑定行；**会话的能力声明自此冻结**。
- 再进恢复：有绑定行时原样恢复会话——对话上下文、压缩摘要、专属记忆原样都在。
- 激活视图：把目标会话切到客户端当前视图；被切走的旧会话若有在途回合，按宿主无人值守契约在后台继续，绝不打断。
- 显式解绑：拆除绑定行并清除房间专有记忆（破坏性操作，须确认；见 [场景记忆](./recall/)）。
- fail-loud：绑定行损坏当场报错，不静默重绑。

## 3. Contract

```ts
interface ComboBinding {
  comboKey: ComboKey              // 场景×预设组合键
  sessionId: SessionId            // 专属会话
  createdAt: number               // 首次进门时刻（毫秒）
  lastActiveAt: number            // 最近激活时刻（毫秒）
}

interface BinderOps {
  /** 首次创建、再进恢复；返回该组合的当前状态。 */
  bindOrResume(comboKey: ComboKey): Promise<ComboState>
  /** 当前视图所在房间。 */
  current(): ComboState | undefined
  /** 显式解绑：拆除绑定行并清除房间专有记忆；须确认凭证。 */
  unbind(comboKey: ComboKey, confirmToken: ConfirmToken): Promise<void>
}
```

## 4. Flow

```ts
async function bindOrResume(comboKey: ComboKey): Promise<ComboState> {
  const binding = store.find(comboKey)
  if (binding) {
    const session = sessions.get(binding.sessionId)
    if (!session) {
      // 指向的会话已不存在（被外部删除）：显式重建，账本注明，不静默。
      const fresh = await sessions.create(assemblyFor(comboKey))   // 按预装配新建，声明自此冻结
      store.replace(comboKey, { ...binding, sessionId: fresh.id, lastActiveAt: now() })
      return activate(fresh, "rebuilt")
    }
    return activate(session, "resumed")                            // 原样恢复：上下文与记忆都在
  }
  const def = registry.require(comboKey)                           // 未登记：抛 SCENE_NOT_FOUND
  const session = await sessions.create(assemblyFor(def))          // 首次进门：按预装配创建
  store.put({ comboKey, sessionId: session.id, createdAt: now(), lastActiveAt: now() })
  return activate(session, "created")
}

async function unbind(comboKey: ComboKey, confirmToken: ConfirmToken): Promise<void> {
  requireConfirm(confirmToken)                                     // 破坏性操作：无确认凭证即拒绝
  const binding = store.find(comboKey)
  if (binding) {
    memoryScopes.dropRoom(binding.comboKey)                        // 清除房间专有记忆
    store.remove(comboKey)                                         // 会话本体保留（宿主会话列表可见），仅解除绑定
  }
}
```

恢复策略：绑定行损坏（键与载荷不一致、校验失败）→ 当场抛 `SCENE_BINDING_CORRUPT`，fail-loud，不静默重绑；指向会话已不存在 → 显式重建并注明 `rebuilt`，旧上下文不可恢复是如实结果而非隐藏错误。被解绑房间的会话本体保留在会话列表（人的数据不删），但场景视图不再指向它，房间专有记忆作用域清除。

## 5. Acceptance

1. **首次进门创建**：无绑定行的组合首次进入 → 按预装配创建专属会话，绑定行落库，声明自创建起冻结。
2. **再进恢复同一会话**：离开房间后再进 → 恢复同一会话（sessionId 不变），对话上下文与压缩摘要原样可用。
3. **在途不打断**：切走时旧会话有进行中的回合 → 该回合按无人值守契约在后台继续完成并落账，不被激活操作打断。
4. **损坏响亮失败**：绑定行损坏 → `SCENE_BINDING_CORRUPT`，不静默重绑；指向会话被外部删除 → 显式重建并注明 `rebuilt`。
5. **解绑破坏性防护**：无确认凭证的解绑被拒绝；有凭证的解绑清除房间专有记忆、解除绑定，会话本体保留。
