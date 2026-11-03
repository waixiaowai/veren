# notebook 4.0.0-rc.3 画布优化真机验收报告（稳定节点 3080）

> 验收时间：2026-11-03 11:20–11:42（Asia/Shanghai）。节点：`deepseek\.dsh` web profile，端口 3080，`DSH_HOME` 显式。
> 构建：四包 `4.0.0-rc.3` 本地 tarball 装入；3080 验收构建的 `@veren/notebook-ui` `lib/client.js` 为 **449268 B**（Konva 10 场景图 + 0.85 打开视口 + 空盒指引 + 二次贝塞尔边 + dock 折叠 + 归属选举/记忆）。最终提交 `51dc395`（含卡片选中/连通分量特性）构建为 **452828 B**，在 3082 冷启动冒烟（同一 `DSH_HOME`，见 §1）。
> 证据：本目录 `evidence/*.png` 为真实宿主上的 Chrome headless 截图；读数由 CDP 在同一页面读出。
> 基座变更：用户 2026-11-03 11:23 裁定「以 Konva 为基座」，覆盖任务书 §2 边界里的「不拆 canvas.tsx」。`canvas.tsx` 现为 103 行组装层，渲染拆到 `canvas-stage` / `canvas-scene` / `canvas-card` / `canvas-theme` / `canvas-viewport*` 等文件。

## 0. 结论速览

| # | 验收项 | 结论 | 证据 |
|---|---|---|---|
| 1 | O1 归属选举 | **过** | 全新浏览器 profile（`lastOwner=null`）首开落在 `standard`，读数为 9 卡；空声明的 `cordis` 不再抢走首屏 |
| 2 | O5 归属记忆 | **过** | 切到 `cordis` 后 `notebook-last-owner=cordis`；整页 reload 后仍为 `cordis` |
| 3 | O2 新建回路 | **过** | 画布点「新建笔记」→ 列表编辑器（h2「新建笔记」）→ 填标题/正文 → 保存 → 自动回画布，计数 `笔记 1`，截图见 03/04 |
| 4 | O3 画布空态 | **过** | 空盒 `cordis` 中央出现 `.notebook-canvas-empty`：「这本记事本还是空的。切到列表，写下第一条——画布只负责看关系。新建笔记」，截图 02 |
| 5 | O4 可读默认缩放 | **过** | 默认 `data-canvas-zoom=0.85`；卡标题 13px × 0.85 = **11.05px**；「适配」仍可用（本次 0.931，9 卡全见），截图 01/06 |
| 6 | O6 曲线边与命中 | **过** | 8 条边为二次贝塞尔；悬停计算出的边中点后两端卡点亮、其余压暗，截图 05；命中线用同一 `Path`（12px hitStrokeWidth） |
| 7 | O7 dock 折叠 | **过（组件预览 + 单测）** | `tests/dock.spec.ts` 4 条：≤3 保持列表、≥4 收成计数行、展开恢复行；真实宿主 0 条过期，改用同一组件 + 同一 CSS 的 5 条合成过期卡预览：折叠态 0 行 + 计数 5 + 展开钮，展开后 5 行 + 收起；截图 08/09 |
| 8 | 回归 | **过（验收构建）** | 四包 166 测全绿（notebook 63 / app 19 / ui 78 / bundle 6）；四包 typecheck 无 src 诊断；面板在 3080 正常挂载，未复现旧的 entry-abdication 拆分诅咒 |

## 1. 真机读数

首开（清空 localStorage 的独立 Chrome profile）：

```json
{"owner":"standard","lastOwner":null,"zoom":"0.85","count":"笔记 9","stage":{"w":1078,"h":736},"canvases":1}
```

切到空盒并 reload 后：

```json
{"owner":"cordis","lastOwner":"cordis","count":"笔记 0","empty":true,
 "emptyText":"这本记事本还是空的。\n切到列表，写下第一条——画布只负责看关系。\n新建笔记"}
```

O2 保存后：

```json
{"canvasMode":true,"listMode":false,"canvasCount":"笔记 1","dirty":false}
```

O4 适配：

```json
{"zoom":"0.9313261163734776","titlePx":"12.11"}
```

最终仓态快照（3082 冷启动，端口 3082、同一 `DSH_HOME`）：

```json
{"port":"3082","owner":"standard","zoom":"0.85","count":"笔记 9","canvases":1,"empty":false,"lastOwner":null}
```

## 2. 证据清单

| 文件 | 内容 |
|---|---|
| `evidence/01-default-standard.png` | 首开 default：owner=standard、9 卡、zoom 0.85、8 条曲线边 |
| `evidence/02-empty-cordis.png` | 空盒 cordis：画布中央空态卡 |
| `evidence/03-authoring-list.png` | 画布点新建后落到列表编辑器 |
| `evidence/04-saved-canvas.png` | 保存后自动回画布，`笔记 1`，新卡在场 |
| `evidence/05-edge-hover.png` | 悬停一条边的中点：两端点亮、邻域外压暗 |
| `evidence/06-fit-all.png` | 显式「适配」：9 卡全部进入视口 |
| `evidence/07-final-build-3082.png` | 最终仓态快照在 3082 冷启动：同样的 standard/9 卡/0.85，面板正常挂载 |
| `evidence/08-dock-fold-preview.png` | O7 组件预览：3 条保持全列表；5 条收成「进料口 5 + 展开」一行 |
| `evidence/09-dock-expanded-preview.png` | O7 展开后 5 行 + 收起钮 |

## 3. 装配配方与修复

- tarball：`%TEMP%\notebook-rc3`（notebook / notebook-app / notebook-ui 4.0.0-rc.3 + app-host-bundle 2.2.1 + bundle），`pack-local.mjs` → `repack.mjs`。
- profile 由 **pnpm 11.28.5** 安装（其 store 为 `.pnpm-store/v11`，仓库根的 pnpm 10 会报 `ERR_PNPM_UNEXPECTED_STORE`）；安装后 profile 依赖为 `@veren/notebook-bundle 4.0.0-rc.3`。
- `repack.mjs` 修复：Windows 的 `tar` 可能是 System32 的 bsdtar，它拒绝 GNU 的 `--force-local`。脚本改为探测能力后再加该开关，否则 repack 直接失败。
- 3080 启动日志仅出现一条既有的 `dsh-workbuddy-oauth` 跳过告警，与本包无关；面板正常挂载。

## 4. 缺口与边界

- **O7 真机视觉**：真实 `standard` 盒 9 卡均未过期，`cordis` 为空盒；没有 >3 过期卡的现成数据。为不篡改真机存储，视觉裁决改用**同一 `CanvasDock` 组件 + 同一 `panel.css`/`canvas.css`**、以 5 张合成过期卡渲染的独立预览页（截图 08/09）；折叠规则另有 4 条纯函数单测。宿主真机上的 >3 形态仍未触发。
- **并发改动**：验收构建安装于 11:25；11:36–11:51 另一会话在 Konva 基座上增加「卡片选中/连通分量高亮」，现已作为 `51dc395` 提交。四包门禁在该提交上全绿；其构建（452828 B）在 3082 冷启动冒烟通过。3080 上的 449268 B 构建不含该特性，O1–O7 的真机证据不受影响。
- **拆分诅咒**：本次 Konva 多文件拆分在 3080 正常挂载（9 卡、8 边、面板无 entry-abdication），旧的 `ac7df98` 结论在本构建上未复现；保留记录待后续复测。
- 宿主详情页零工具（defect D）仍按原任务书挂账，不在本泳道。

## 5. 门禁

| 项 | 结果 |
|---|---|
| notebook 单测 | 63/63 过 |
| notebook-app 单测 | 19/19 过 |
| notebook-ui 单测 | 78/78 过（9 个 spec，含新增 dock 折叠 4 条） |
| notebook-bundle 单测 | 6/6 过 |
| 四包 typecheck | 无 src 诊断 |
| `pnpm check:docs` | 过（178 篇文档，21 条声明） |
| `pnpm check:src-artifacts` | 过 |
| `pnpm check:function-length` | 仅 `plugins/dsh-superagent` 的 62 个超长函数（在途改动，与本泳道无关） |
| `pnpm check:entries` | 仅 `plugins/dsh-superagent` 的 `lib/index.d.ts` 未构建（在途，需先 build） |
