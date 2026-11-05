---
title: 登记处（Registry）
description: "收下组合门牌说明（场景×预设定义），校验合格后登记，插件卸载时逆序注销；只管『有哪些房』。"
sidebar:
  order: 2
  label: 登记处
draft: false
lastUpdated: 2026-11-05
---

## 1. Responsibility

登记处是房间门牌说明的唯一入口：插件把一份组合定义（场景×预设的固定搭配）交进来，它校验合格后登记在册，插件卸载时逆序注销。它与相邻模块的分界：它不判断「现在该进哪间」（判定器的事），也不创建或恢复任何会话（绑定器的事）；判定器与绑定器读到的每一份定义都来自这里。

## 2. Features

- 接收组合定义：场景标识、预设引用、双语名称、进入条件、预装配清单（该房间的工具与技能目录）、页面指向。
- fail-loud 校验：场景标识重复、引用的预设或工具不存在、页面指向无效、双语名称缺失——当场拒绝，不带病注册。
- 登记即返回注销凭证；插件卸载时逆序注销；已绑定房间的运行不受影响。
- 按标识查询与全量列表，供判定器、绑定器与指示面读取。

## 3. Contract

```ts
interface ComboDefinition {
  id: SceneId                               // 场景标识（组合键的一半）
  presetId: PresetId                        // 预设引用（组合键的另一半）：这间房里住着谁
  label: LocaleString                       // 双语名称，必填
  enter: SceneEnterCondition                // 显式进入 / 自动判定条件
  assembly: AssemblySpec                    // 预装配：该房间的工具清单与技能目录
  page?: PageRef                            // 页面指向（可选）
}

interface SceneRegistry {
  register(def: ComboDefinition): Disposable
  get(id: SceneId): ComboDefinition | undefined
  list(): readonly ComboDefinition[]
}
```

## 4. Flow

```ts
function register(def: ComboDefinition): Disposable {
  validate(def)                             // 重复标识 / 预设或工具引用缺失 / 名称缺失 → 当场抛错
  definitions.set(def.id, def)
  notify("registered", def)                 // 判定器与指示面由此得知新房间
  return once(() => {
    definitions.delete(def.id)
    notify("unregistered", def)
  })
}
```

恢复策略：已绑定房间的定义被注销时，**不打断现场**——当前房间继续有效直到离开；离开后该房间无法再进入（`SCENE_NOT_FOUND`），绑定行保留与否由[绑定器](./binder/)的解绑语义决定。

## 5. Acceptance

1. **合格登记**：合法组合定义登记后，判定器与指示面立即可见，注销凭证可用。
2. **fail-loud 拒绝**：引用不存在预设或工具的定义被当场拒绝并返回 `SCENE_DEFINITION_INVALID`，登记表无残留。
3. **逆序注销**：插件卸载后其全部定义按登记逆序注销；已绑定房间不打断，离开后按 `SCENE_NOT_FOUND` 拒绝再进。
