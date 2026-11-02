# notebook 4.0.0-rc.1 真机验收报告（3080 稳定节点）

> 日期：2026-11-02。对象：`@veren/notebook(-app/-ui/-bundle) @4.0.0-rc.1`（本地 tarball 安装，未发布）。
> 节点：`deepseek\.dsh`（DSH_HOME 显式携带，port 3080，web profile，pnpm 11）。
> 任务书：`docs/notebook-note-types.cn.md`（三类生命周期：闪念/永久/项目 + promote/trash/archive + ledger 仪表）。
> 结论：**十项清单 7 过、3 项被同一宿主层缺陷阻塞（③⑤⑥ 的模型面；代码面有组合测试覆盖），另发现并当场修复 1 个设计缺口（缺陷 E）。安装链路两处工具链 bug 顺手修复。**

---

## 1. 十项清单结果

| # | 项 | 结果 | 证据 |
|---|----|------|------|
| ① | 升级路径：存量卡零迁移落位 permanent | ✅ | 介质铁证：`storages/notebook.json` 打开后 **11 行存量卡在盘上全部无 `kind` 字段（零迁移、不改写）**，`links` 8 行完好，`linksSyncedAt:1` 未触发重建；域带这些行成功打开 = schema default 读作 permanent 生效。UI 徽章人验因壳层自动化陷阱未拍（见 §3.4），以介质+启动为判据 |
| ② | 闪念捕获：悬链放行、过滤正确 | ✅ | 真机模型面：`capture_note` 返回 `kind:"fleeting"`、标题自动从首行铸出、悬空 `[[还不存在的卡]]` 放行；`list_notes(kind:fleeting)` 恰返回闪念、永久卡被滤；介质 `links` 表零新增行 = 不入图 |
| ③ | promote：拒绝半+成功半 | ❌ 阻塞 | 真机被缺陷 D 挡（note 详情页打开即拒，见 §2）；代码面由 `app.pages.spec`（note 页登记断言）+ lifecycle.spec 覆盖 |
| ④ | 盲测：AI 主动提出过期闪念炼/扔 | ✅✅ | 开放式提问（"我的卡片盒有什么需要我注意的？"，零提示词），AI 全读 13 卡后主动点名「**闪念队列积压了 2 张，按卡片盒自己的规则应该在 1–2 天内处理掉**」，判定两张 rc7 卡"纯测试语、没有可提炼的想法"（指向扔），并抓到介质手术指纹（updatedAt 早于 createdAt 且同毫秒=回填特征）。列表页首屏「**进料口（2 条，均已过期，应当先加工）**」段真机渲染成功 |
| ⑤ | trash：闪念可删、无 TTL | ⚠️ 半 | 无 TTL 由 ④+⑧ 佐证（2 张闪念置 3 天前、跨三次重启仍在）；delete 点击流与 ③ 同根被阻塞 |
| ⑥ | archive：蒸馏证据前置 | ❌ 阻塞 | 同 ③（archive_note 页面作用域）。其创建路径缺口已修（缺陷 E） |
| ⑦ | 永久卡不得链接闪念 | ✅ | 真机拒绝原文：`these link targets have no card in this notebook: [[rc7闪念二号：纯粹的提醒物]]`——闪念不是链接地址 |
| ⑧ | box_stats/账表 + 重启持久性 | ✅ | `ledger` 账表 2 行 captured + 2 张闪念**跨三次节点重启**完好；box_stats 模型面被缺陷 D 挡（页面作用域），算术面由 stats 单测覆盖 |
| ⑨ | 全局面恰五件、promote/archive 页面独占 | ✅✅ | 非页面会话模型自报：恰有 capture/find/list/read/write **5 件**，promote_note/archive_note/box_stats 逐个回答"没有" |
| ⑩ | 卸载干净、复装无损 | ✅ | `dsh plugin remove` 后 node_modules 四包零残留、profile 依赖行清零、**存储 13 卡原样**；复装 4.0.0-rc.1 成功 |

## 2. 缺陷 D（宿主层，阻塞 ③⑤⑥ 的模型面）——已定责、未修

- **现象**：任何路径打开 `/apps/notebook/note/:noteId` 一律失败：`detail page "notebook/note" registered no tools; its write duty cannot be fulfilled`（page-registry §3.10.5 挂载期审计）。
- **取证**（profile runtime.js 临时诊断，已还原）：`before` 与 `after` 工具面**逐名字相同**、差集为零——note 页组件体的六次 `agent.ctx.tools.register` **一次都没落进会话工具面**；且行为**boot 间不确定**（restart#2 时期创建的会话模型可见 7 件含 body 登记的 list_hubs/box_stats，restart#3 后的同流程 before==after）。
- **定责**：notebook 家族代码无责——profile 内装的 dist/catalog/pages 均含全部新构建器（逐文件核实）、组合测试绿、列表页/全局面/介质面全过。缺陷位于 page-registry/app-host 的会话工具面快照与组件体登记的落地链路，且 note 页的模型面在 rc.1 报告 §3.1 就写明"经面板人面完成"——**从未真机过，属存量缺陷今日首爆**（应用菜单首次让页面打开成为可能）。
- **处置**：交 page-registry/app-host 泳道；诊断补丁已全部还原（profile runtime.js 从 npm 发布原件字节级恢复）。

## 3. 当场修复

### 缺陷 E（notebook 家族，已修复待随 rc 线发布）：项目卡没有创建路径

- **现象**：状态机的 `project` 态从工具面不可达——capture_note 不能带 anchor，write_note 只出永久卡；真机驱动验收时暴露。
- **修复**：`capture_note` 增 `anchor?` 参数（task-workbench taskId）——**带锚即项目卡**（同样的宽松纪律：免标题、可悬链、不入图），服务/端口/描述/测试同线更新（空锚拒绝 `input-invalid`）。
- **回归**：lifecycle.spec 项目创建用例改为走真实 capture 路径（删行手术垫片）；包测试全绿。

### 工具链两处（notebook-bundle repack.mjs）

1. 成员 tarball 版本名硬编码为 bundle 版本——app-host-bundle 走独立 2.2.1 线必炸；改为按成员自己的 tarball 解析。
2. win32 下 node 直接 spawn GNU tar：盘符冒号被读成远程主机 + `--force-local` 也不可救（本机实测）——脚本已加正斜杠+force-local（仍败），**本机实际走 bash 手工重打**（tar 在 MSYS 内正常）；后继考虑改纯 node 实现。

### 安装链路备注

- 本地安装流：`pnpm pack` 五包 → 重写 bundle 与成员互指 `file:` → `dsh plugin --profile web add <bundle.tgz>`。
- profile 的 bundle 依赖当前指向 **TEMP 目录的 file: 路径**（一次性验收可接受；发布后应回到 registry 浮动版）。

## 4. 环境坑（本次新入册）

1. **本 harness 的 bash 是 MSYS 且 mount 表无 `/c`**：`/c/Users/...` 被当相对路径落进 `D:\Program Files\Git\c\...`（已清理）；Windows 临时目录的正确别名是 `/tmp`（mount 明文）。对原生子进程传路径一律用 `C:/` 正斜杠形。
2. **DSH 壳层自动化**：合成点击/回车会被周期重渲染吞掉——唯一可靠通道是页面内 JS 触发 DOM click（`playwright.evaluate`）；`dom_cua` 次之。
3. **僵尸 `dsh web` 进程**三代叠听 3080 复现：CIM 枚举 CommandLine 逐杀 + 端口归零校验，照旧。

## 5. 节点终态

- `@veren/notebook-bundle@4.0.0-rc.1`（本地 tarball，file: 依赖）已装；节点在 3080 正常服务。
- 测试数据：standard 盒 13 卡（11 存量 permanent + 2 闪念置过期）+ ledger 2 行 captured；两张过期闪念留给后续盲测复验。
- 遗留：缺陷 D（宿主层）修复后，③⑤⑥ 的模型面与盲测的"炼成提议"需一轮补验。
