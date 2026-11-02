# notebook 缺陷 D 侦缉档案（note 详情页工具面不落地）

状态：机制图完成、排除清单在案、头号嫌疑锁定 isolate/fork 解析——**待一轮插桩实测定罪**（配方 §5）
关联：`docs/acceptance/notebook-4.0.0-rc.1/acceptance-report.cn.md` §2（缺陷定责）、取证审计 `docs/notebook-audit-results.cn.md`（N1：生命周期面真机零使用的根因即本缺陷——promote/archive 全挂页面作用域，页面工具面从未起来）
泳道：page-registry / app-host（本档案撰写时该泳道文件干净，无人占用）

## 1. 症状（真机 3080，验收在案）

1. 任何路径打开 `/apps/notebook/note/:noteId` → `detail page "notebook/note" registered no tools; its write duty cannot be fulfilled`（page-registry §3.10.5 规则 3 挂载审计，`open-page.ts:288`）。
2. 组件体六次 `agent.ctx.tools.register`（pages.tsx:127-132）全部执行且不抛错，但挂载快照差集为零（before==after）。
3. **boot 间不确定**：restart#2 时代创建的会话模型可见 7 件（含 body 登记的 list_hubs/box_stats）；restart#3 同流程归零。
4. 列表页不受影响——但那是**审计盲区假象**：审计只打「参数化 URL + writes:true」（open-page.ts:288），列表页不触发；且列表页 body 登记名与全局五件同名（M1 设计），落不落不可见。

## 2. 挂载链机制图（file:line 全在案）

```
gateway.open (gateway.ts:153) → pageRegistry.openUrl → createPageSession (open-page.ts:169)
  ① reserveRow（行 state=reserved）                     open-page.ts:184
  ② createSessionOrRollback → port.create → openPageSession (session-port-open.ts:73)
       agents.create → agent/created (serial await) → remountPageAgent (page-identity.ts:102)
         → rerenderLivePage（守卫：行 state!=='live' 跳过 → 新建路径不双跑）  page-rerender.ts:63
         → attachPageIdentity（reserved 行也认）
       handles.hold → agent.ctx.tools.restrict({deny:[app_open,app_list,app_pages]})  session-port-open.ts:83
  ③ renderAndCommit → renderOnce (open-page.ts:262)
       before = toolFace(sessionId)                     ← 读 A
       body = match.live.mount(params, agent)           ← 六次同步 register（pages.tsx:127-132）
       pageTools = collectPageTools(before, toolFace())  ← 读 B（open-page.ts:282）
       审计：参数化+writes+delta 空 → DetailInvalid       open-page.ts:288
```

真件语义（dsh-tools 0.2.1-rc.2，root 与 profile 同版本已核实）：
- `register` → `ScopedLayers.effect(this.ctx, …)`：层键 = `scopeOf(this.ctx)`（dsh-scope），**同步**插入（cordis/vendor fiber `_execute` 对同步生成器内联跑完——vendor/cordis/src/fiber.ts:375-382 与 node_modules 版一致，异步缝假说已毙）。
- `schemas(scope)` → `view(scope)` **每次现算无缓存**（index.js:3055）：own=`peek(scope)` + 链上继承层（restrict 只滤继承面，own 层豁免）。
- `toolFaceOf` = `agent.ctx.tools.schemas(scopeOf(agent.ctx))`（session-port.ts:80-82）。

## 3. 已排除（每条带证据）

| # | 假说 | 证据 |
| --- | --- | --- |
| X1 | 登记异步落层（微任务缝） | vendor fiber `_execute` 对同步生成器**内联跑完**（fiber.ts:375-382）；ScopedLayers.effect 的 generator 无 yield |
| X2 | view 缓存陈旧 | `view()` 每次现算（dsh-tools index.js:3055），无 cache/invalidation |
| X3 | 安装产物与源码漂移 | profile app-host/page-registry dist 含全部 HEAD 标记（collectPageTools/rerenderLivePage/schemas(scopeOf/restrict({deny）；版本双 2.2.1；dsh-tools root/profile 均 0.2.1-rc.2 |
| X4 | register 抛错（output 契约） | 抛错则 body 中断，forensics 数到六次调用；且错误面会是 SessionCreateFailed 非 DetailInvalid |
| X5 | remount 抢跑消费一次性渲染 | rerenderLivePage 守卫 `state!=='live'` 跳过 reserved（page-rerender.ts:63）；且即便抢跑，renderOnce 无 WeakSet 检查会**再**渲染（差集非零非空）——与零差集签名矛盾 |
| X6 | collectPageTools 缺陷 | 纯名字差集（page-block.ts:64-66），无过滤 |
| X7 | 组合测试本应抓住 | **测试夹具自认**：app-host.harness.ts:11「ToolRuntime 的 scope 层不在本测试覆盖内」；page-registry runtime.harness.ts:34 假 toolFace 仅"假设与真件同构"——真件 scope 语义**零测试覆盖** |

## 4. 头号嫌疑：per-session 服务隔离下的实例/层错位

vendor cordis `Service` 解析是 **isolate 过滤**的（vendor/cordis/src/service.ts:64-66）：

```ts
protected [symbols.filter](ctx: Context) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

而标准 preset 正是「per-session 服务域」隔离（记忆 dsh-session-isolation-patterns：preset isolate = per-session service realms）。若 `tools` 在会话域被 isolate：

- `agent.ctx.tools` 在 **restrict 时刻（create 内）/ register 时刻（mount 内）/ 快照时刻（renderOnce 前后）/ 模型组装时刻（首回合）** 四个时机可能解析到**不同实例或不同 `this.ctx`**（isolate fork 的懒物化时序）。
- fork 实例的 `this.ctx` 若非 agent.ctx 本尊（isolate 子 fiber 的 ctx），登记落进层 `scopeOf(forkCtx)` ≠ `scopeOf(agent.ctx)`；快照按后者读 → **登记进了孤儿层**。
- boot 间不确定性 = isolate fork 物化与首回合组装的竞速方向随 boot 时序摆动（restart#2 时代模型组装读到的实例恰好已含登记）。
- 佐证：live 的 restrict 未抛「requires a scoped context」（restrict 要求 `scopeOf(this.ctx)≠undefined`，dsh-tools index.js:2989）——说明 restrict 时刻的实例 `this.ctx` 与 register 时刻的未必同一个。

## 5. 定罪实验（一轮插桩，按序）

1. **四时机实例指纹**（首选，一次重启+一次 GUI 开页即定罪）：临时诊断补丁（照验收 TEMP-DIAG 配方）在 session-port 注四处 `console.log`：restrict 前后、renderOnce mount 前后、首回合组装处——各打 `agent.ctx.tools` 的实例标识（如 `Object.getPrototypeOf(...).constructor.name + WeakRef` 或实例自增 id）与 `scopeOf(该实例 this.ctx)`。若四时机实例 id 或 scope 键不一致 → 定罪。
2. **读模型组装通道**：dsh-agent-loop 组装模型工具清单时用什么 scope/实例读 schemas——若与 toolFaceOf 通道不同（实例或 scope 键），两通道分叉即完整解释「快照零、模型后来可见」。
3. **loader-smoke 复现**（无 GUI）：标准 preset + 探针插件走真 loader，在探针里断言四时机一致性；隔离临时 DSH_HOME（脚本创建，测完删）。
4. 修复方向（定罪后择一，最小面）：toolFaceOf 改走与模型组装**同一条解析通道**；或 mount 内的登记改经与快照同实例的引用（mount 返回登记句柄而非靠全局 accessor）；或 restrict/登记统一挪到 fork 物化之后（agent/created serial await 内完成）。

## 6. 定罪（2026-11-03 插桩实测，证据 = 临时 boot 日志）

四时机指纹插桩（dsh-tools register + app-host toolFaceOf/restrict/port.toolFace，globalThis 共享 WeakMap 实例 id）两轮 boot 采集，**机制坐实**：

1. **实例非确定解析实锤**：同一会话 remount 的两次 toolFace 读（mount 前后相邻）解析到**两个不同 ToolRuntime 实例**（`inst=1 → inst=2`，`sameCtx=true` 但实例 id 变了）。body 的 register 若落在实例 1、快照读实例 2 → 差集为零 → DetailInvalid。boot 间差异 = fork 物化时序摆动（restart#2 时代 A=B 同实例 → 正常）。
2. **`agentScope=undefined`**：页面会话 agent 的 ctx **无 kScope 标签**——`toolFaceOf` 的 `schemas(scopeOf(agent.ctx))` 实际读的是实例的**全局视图**；dsh-tools 的 scope 分层设计在真机上整体旁路，身份完全落在"哪个实例"上。
3. **boot 期 92 条 register = 92 个实例**（每条一个，scope 全空）——`ctx.tools` 是 per-fiber fork 解析：每个触达它的 fiber 各得一个实例，provider 插件在 fork 上重放全局登记（所以每个 fork 都带 26 件全局工具），但**经 fork 登记的页面工具只活在那个 fork 里**。登记实例 ≠ 快照实例 ≠ 模型组装实例时，页面工具面即蒸发。
4. 范围勘定：`@deepseek-ai/dsh-tools` 宿主实跑的是 **harness vendor 包**（`deepseek-harness/packages/core/tools`，tsx 直跑 TS 源码）——与 cordis 同为 vendor 化；profile node_modules 的同版本副本不被宿主加载（第一轮插桩打错位置零输出的原因）。

**修复归属待裁决（不定罪单方面改官方源码）**：
- 上游（deepseek-ai 官方仓）：ToolRuntime 的 per-fiber fork 对有状态注册表是否是设计意图？若是，app-host/page-registry 必须 pin 实例；若否，上游修 fork 语义。
- 本仓可做的对症修复（app-host，干净泳道）：会话生命周期内 pin 一次实例——create 时捕获 `const tools = agent.ctx.tools` 存入 handles，toolFaceOf 与模型组装通道统一走捕获引用；body 的 `agent.ctx.tools` 与 pin 实例的一致性需一并验证（否则换汤不换药）。
- 诊断补丁已全部还原（profile 双文件 + harness tools src，sha256 比对 byte-identical；harness git 树 clean）；采集日志留存于 `%TEMP%/defectd-boot.log`、`defectd-boot2.log`。

## 7. 修复后的验收钩子

- 单测：真件 ToolRuntime + 真 isolate 拓扑的 scope 层测试（补上 harness.ts:11 自认的盲区），断言「restrict → body register → 立即 schemas 可见」。
- 真机：notebook 4.0.0-rc.1 十项清单 ③⑤⑥ 补验（acceptance-report §2）+ 取证审计预测 PR1-PR3 前置解锁。
