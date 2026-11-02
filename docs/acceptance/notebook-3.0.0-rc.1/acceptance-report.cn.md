# notebook 3.0.0-rc.1 真机验收报告（3080 稳定节点）

> 日期：2026-11-02。对象：`@veren/notebook(-app/-ui/-bundle) @3.0.0-rc.1`（registry 发布物）。
> 节点：`deepseek\.dsh`（DSH_HOME 显式携带，port 3080，web profile，pnpm 11）。
> 结论：**八步清单全过（含三处真机缺陷当场定位、修复、回测）**；介质零迁移铁证到手。
> 证据目录：`docs/acceptance/notebook-3.0.0-rc.1/evidence/`（全部为真机截图/介质快照）。

---

## 1. 八步清单结果

| # | 项 | 结果 | 证据 |
|---|----|------|------|
| ① | 升级路径：2.2.1 → rc.1，既有笔记可见完好 | ✅ | `01-upgrade-old-notes-visible.png`；介质快照 `notebook-v1-before-upgrade.json`（升级前 3 条 v1 笔记） |
| ② | 写卡链到既有卡 → 成功 | ✅ | `02-write-card-with-link-success.png`（`[[2.0.3 验收]]` 写入时解析成功，`list_hubs` 即报 inbound=1） |
| ③ | 链到不存在标题 → 拒绝+建议 | ✅（修复后） | 缺陷态：`03-...-DEFECT-generic-error.png`；修复态：`03b-...-FIXED-structured-refusal.png` |
| ④ | 改名 → 引用方正文改写+反链跟随 | ✅ | `04-rename-rewrites-referrer-body.png`（`[[rc1验收·改名实验]]`→`[[rc1验收·改名实验·新址]]`，⟲1 保持，hub id 不变） |
| ⑤ | 删除被引用卡 → 拒绝+点名引用方 | ✅ | `05-delete-guard-names-referrer.png`（`card-referenced`：点名「rc1验收·汇聚卡」含 id） |
| ⑥ | list_hubs / list_backlinks 如实 | ✅ | `06a-list-hubs-truthful.png`（三入口各 inbound=1 原样 JSON）；`06b-panel-backlink-badges.png`（⟲ 角标全对）；面板出链/反链两段见 05 截图下半 |
| ⑦ | 重启 → 卡片与链接完好 | ✅ | `07-restart-data-intact.png`（重启后首屏重投，改名/链接/入口三行跟随表全过，6 卡无损） |
| ⑧ | 卸载组合包 → 干净拆除 | ✅ | node_modules 零 notebook 残留、bundle 行清零、启动日志无 notebook 注册；**存储域 6 卡原样保留**；复装 `^3.0.0-rc.1` 后首屏完整送达 |

介质升级铁证（①的底层）：`storages/notebook.json` 打开后 `global.linksSyncedAt: null → 1`、`unit.version` 保持 1（零迁移）、新增空 `links` 表（旧正文无链接，正确）。

## 2. 真机缺陷三处（全部已定位根因、修复、回测）

### 缺陷A（严重，用户可见）：面板「选中↔未选中」死循环闪动

- **现象**：notebook-ui 面板在选中和未选中两态间高频切换；行点击不生效（选中即被清）。
- **根因**：`use-notebook-view.ts` 的 `useOwnerChangeReset` 把**每次渲染都新建的内联闭包**放进 effect 依赖 → 每次渲染后都触发重置 → 与跟随副作用（selectedId 为空即自动选第一条）打成乒乓。
- **修复**：重置闭包走 `useRef`，effect 只依赖 `owner`。
- **回测**：编辑器选中稳定（3 秒前后同值）；行点击→编辑器正确切换并保持（04/05 截图即修复后面板的交互中状态）。

### 缺陷B（严重）：cardLinks 请求风暴打爆浏览器

- **现象**：浏览器 console `cardLinks` 请求刷出 11 万+条 `ERR_INSUFFICIENT_RESOURCES`；`owners` 等请求被饿死报 `Failed to fetch`。
- **根因**：`note-links.tsx` 的 effect 依赖里放了 `fetchLinks` 回调——宿主注入面每次渲染给新函数身份 → 每次渲染重拉；与缺陷A的渲染风暴叠加成请求风暴。
- **修复**：回调进 ref（动作不是数据，不进依赖），effect 只依赖 `owner/selectedId/editingNew`。
- **回测**：面板打开后请求平静，链接两段正常读取（05 截图「卡片链接」区如实）。

### 缺陷C（严重，模型面）：坏链拒绝被压成无信息通用文案

- **现象**：`write_note` 坏链被拒（数据无损），但模型只收到 `Error: The notebook operation failed.`——`notebook/link-unresolved` 码、拒绝原文、相近标题建议全部丢失。
- **根因**：pnpm 在 `@veren/notebook-app/node_modules/@veren/notebook` 装出了**第二份 @veren/notebook 实例**。服务从根实例抛 `NotebookError`（类 A），工具的 `error instanceof NotebookError` 检查的是嵌套实例的类 B → 恒假 → `internalError()`。单测不抓：vitest 单模块图内 instanceof 恒真——这正是「真机验收存在的意义」。
- **修复**（`plugins/notebook/src/tools.ts`）：按框架既有约定改用结构识别 `remoteErrorOf()`（`isDSHRemoteError` 标记 + code 前缀），对类身份免疫。框架注释原文即写着「Discrimination is always by `code`, never by instanceof」——我们的代码违反了它。
- **回归测试**：`tests/tools.spec.ts` 新增「跨实例拒绝按结构翻译」用例（桩端口抛异类同构错误，断言 code+message 透传），34/34 绿。
- **回测（真机）**：坏链重放返回完整三要素——缺失目标、相近标题「rc1验收·改名实验」、`\[[` 转义提示（`03b` 截图）。

## 3. 其他发现（不阻塞，已记录）

1. **深链不开页面会话**：浏览器直达 `/apps/notebook/list?rc1probe=1` 或 `/apps/notebook/note/:id`（含新标签冷启动）均不创建 `app_pages` 行，SPA 恢复上次的会话。影响「重开同 URL 总是新建」契约与 note 页工具的模型面验收路径（④⑤本次经面板人面完成——同一服务契约）。需单独排查（疑宿主壳层问题，非 notebook 一家）。
2. **owners 偶发 `Failed to fetch`**：面板顶部横幅出现过一次，为缺陷B socket 池饿死的伴生症状；B 修复后未复现。
3. **僵尸进程坑复现**：多轮重启中 `dsh web` 子进程存活导致 EADDRINUSE、新进程绑口失败而旧僵尸继续服务（打补丁不生效的元凶之一）。已按记忆配方（逐 PID 清杀+端口归零校验）处置。

## 4. 节点终态

- `@veren/notebook-bundle@^3.0.0-rc.1`（浮动，registry）已装；嵌套第二实例已清除且复装未再出现。
- **节点当前携带热修复 dist**（等价于未来 rc.2：tools.ts 结构识别 + 两处 UI 循环修复），源码修复在工作区未提交。
- 测试节点数据：standard 盒 6 卡（3 张旧卡 + rc1验收 3 张），链接/入口如上。

## 5. 发布列车 rc.2（已完成，2026-11-02）

1. ✅ 源码修复四文件提交（`a09bd00 fix(notebook)`）+ 本验收报告入库；
2. ✅ 四包 bump `3.0.0-rc.2` → registry 发布（65 清单验证全过）→ release commit `5173dd6` + tag `v3.0.0-rc.2`；
3. ✅ staging 3100 pin `3.0.0-rc.2`，boot 干净、介质完好（version 1 / linksSyncedAt 1）；
4. ✅ 3080 复装正式 rc.2（registry 产物替代热修复 dist），坏链终验返回完整结构化拒绝——且相近标题建议已跟随改名指向「新址」，标题索引随改名更新的细节同时得到验证。
5. 待办遗留：深链不开页面会话问题单独立排查；git push 单独决定；`3.0.0` 正式 + 市场索引随行（观察期后）。

## 6. 证据索引

```
evidence/
  01-upgrade-old-notes-visible.png            ① 升级后旧 3 笔记可见
  02-write-card-with-link-success.png         ② 写卡+链接成功
  03-link-unresolved-DEFECT-generic-error.png ③ 缺陷态：通用错误文案
  03b-link-unresolved-FIXED-structured-refusal.png ③ 修复态：结构化拒绝
  04-rename-rewrites-referrer-body.png        ④ 改名改写引用方（列表双卡可见）
  05-delete-guard-names-referrer.png          ⑤ 删除守卫点名引用方 + ⑥ 面板出链/反链段
  06a-list-hubs-truthful.png                  ⑥ list_hubs 原样返回
  06b-panel-backlink-badges.png               ⑥ 面板 ⟲ 角标
  07-restart-data-intact.png                  ⑦ 重启后完好（三行跟随表）
  notebook-v1-before-upgrade.json             ① v1 介质快照（升级前）
```
