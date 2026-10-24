# 3080 稳定节点 2.0.3 验收（三个真机 bug 修复轮）：成功

- 时间：2026-10-24（本轮验收当日）
- 节点：稳定测试节点（工作区 `deepseek\.dsh`，profile=web，端口 3080）——按 AGENTS.md「稳定测试节点」一节源码直起，未用任何 tarball 临时节点
- 版本：全部 `@veren` 工作区包统一 **2.0.3**（commit `6bcc08a` fix(release): 2.0.3 - stable-node bug fixes and version unification）
- 启动方式：`dsh web --port 3080 --no-open`；token 在启动日志 `dsh web:` 行（本轮留存于 `/tmp/dsh-boot-203.log`）
- 安装链：`@veren/app-host-bundle`、`@veren/forum-bundle`、`@veren/notebook-bundle`、`@veren/person-agent-bundle`、`@veren/sub2api-admin-bundle`、`@veren/app-host-ui`、`@veren/prompt-page` 均 `^2.0.3`（registry 安装）；`@veren/task-workbench` 走 tarball（`.tmp-plugin-packs/veren-task-workbench-2.0.3.tgz`，见「发布链说明」）

## 三个修复 bug 的现象 / 根因 / 修复 / 真机验证

### Bug 1：记事本入口 — "notebook services are not bound"

- **现象**：打开记事本应用（选中预挂渲染与页面打开）当场 fail loud：`[notebook-app] notebook services are not bound; registerNotebookApp must run before pages open`（`plugins/notebook-app/src/pages.tsx:51` 的装配契约守卫）。
- **根因**：`registerNotebookApp`（`plugins/notebook-app/src/app.ts`）在重构中丢了第 2.5 步 `bindNotebookServices(port, tools)` 调用——页面模块的装配期槽位（选中预挂的预览渲染 + 页面组件体 `requireServices` 的服务面来源）从未绑定，任何页面一打开就踩守卫。
- **修复**：在 `registerNotebookApp` 的注册 effect 里，工具备好之后、页面注册之前补回 `bindNotebookServices(port, tools)`——绑定必须先于任何页面打开；失败路径的逆序回滚与卸载逆序清理保持不变。
- **真机验证**：记事本应用打开正常，列表页浏览/新建、详情页读取/改写/删除全走通，选中即预挂渲染不再报错。

### Bug 2：Person Agent 入口 — "cannot get property skills without inject"

- **现象**：打开 `/apps/person-agent/*` 页面会话报 `cannot get property "skills" without inject`（cordis `reflect.ts` 的属性访问守卫），Person Agent 页面完全不可用。
- **根因**：页面会话的 agent 作用域由宿主会话机制创建，而 preset realm 把 skills **隔离**（isolate）了：属性访问 `agent.ctx.skills` 重定向进隔离子域（页面会话里是空的），`ctx.get('skills')` 却读主链——两条通道不同，`get` 探测返回"已提供"而属性访问照样 fail loud（真机实测的双通道陷阱）。
- **修复**：`app-host` 的 session-port `agentOf`（`plugins/app-host/src/session-port.ts`）改以**属性探测**为准：`void agent.ctx.skills` 抛错就把一个真正的 `SkillRegistry` 挂进 `agent.ctx.isolate('skills')`——单会话 runtime skill 本就该会话私有，随 agent fiber 生灭、绝不泄漏到别的会话；属性访问本已成功的部署什么都不做、绝不遮蔽。
- **真机验证**：修复后 Person Agent 页面正常，首屏 2 秒到达；页面 skills（dispatch/renhua 等）在页面会话里可用。

### Bug 3：harness web 深链 404 — SPA history fallback 缺失

- **现象**：直接打开或刷新应用深链（如 `/apps/forum/catalog`）得到空白 404，只有从 `/` 进入站内导航才正常。
- **根因**：`deepseek-harness/packages/host/frontend-static` 只服务真实文件——无扩展名的 miss（本是人前端路由）直接落到 404，SPA history fallback 缺失。
- **修复**：无扩展名 miss 先渲染 index 壳（`renderIndex`），**渲染成功再写头**（渲染先行、写头在后：index 文件缺失时壳降级 404——头一旦发出就不能改写）；鉴权与 `/` 相同（`authorizeIndex`）；带扩展名的资源缺失仍 404；目录穿越 403、非 GET/HEAD 405 语义不变（`frontend-static/src/index.ts` 的 `serveStatic` SPA 回退分支）。
- **真机验证**：见下节探测——未认证深链 401（与 `/` 同鉴权，不再是 404），认证后四个应用深链全部 200 送出 index 壳，`/missing.js` 仍 404。

## 四应用真机验收状态

| 应用 | 状态 | 验证要点 |
| --- | --- | --- |
| 论坛（forum） | ✅ | 首屏 effect + followup 5 秒内到达；跨会话投递正常；工具作用域互斥（列表页/详情页只见各自的 `forum__*` 工具） |
| 任务工作台（task-workbench） | ✅ | list/detail 页会话按 URL 分域建立，页面工具挂载与任务通知投递正常 |
| Person Agent | ✅（Bug 2 修复后） | 首屏 2 秒；页面会话 skills 正常挂载（isolate 兜底生效） |
| 记事本（notebook） | ✅（Bug 1 修复后） | 列表/详情页正常，页面工具 `notebook__*` 走组件体注册 |

## 只读 HTTP 探测记录（curl，仅 GET，2026-10-24）

token 读自启动日志 `dsh web:` 行；认证通过 `/?token=…` 换取 cookie（303 See Other + `set-cookie: dsh-auth-…`）后携带 cookie 探测。**未做任何写操作，未重启节点，未改动 `deepseek/.dsh`。**

| # | 请求 | 结果 | 判定 |
| --- | --- | --- | --- |
| 1 | `GET /`（未认证） | **401** | ✅ 首页鉴权正常 |
| 2 | `GET /apps/forum/catalog`（未认证） | **401** | ✅ **深链修复证据**：与 `/` 同鉴权，不再是 404 |
| 3 | `GET /?token=…` | **303** → `./` + cookie | ✅ token 换 cookie 流程正常 |
| 4 | `GET /apps/forum/catalog`（cookie） | **200**，`text/html; charset=utf-8`，39380 字节 | ✅ 深链送出 index 壳（含 `<base href="./">`） |
| 5 | `GET /apps/task-workbench/list`（cookie） | **200**，同上 | ✅ |
| 6 | `GET /apps/notebook/list`（cookie） | **200**，同上 | ✅ |
| 7 | `GET /apps/person-agent/overview`（cookie） | **200**，同上 | ✅ |
| 8 | `GET /missing.js`（cookie） | **404** | ✅ 资源缺失仍 404（回退只吃无扩展名路径） |
| 9 | `GET /no-such-route`（cookie，无扩展名） | **200**（index 壳） | ✅ 未知前端路由交给 SPA 客户端路由 |

启动日志核查（`/tmp/dsh-boot-203.log` 全文 13 行）：唯一未激活项为 `sub2api-admin (@veren/sub2api-admin): Error: Sub2API baseUrl is missing: set the plugin config baseUrl or SUB2API_BASE_URL`——**已知配置噪音**（该插件要求显式配置 baseUrl，未配置即 fail loud），非本轮回归；其余条目（含四个应用与 `llm-deepseek-account` 模型加载）全部正常激活。

## 发布链说明

### 两轮列车（2.0.2 → 2.0.3）

本轮发布走两轮列车，均于 2026-10-24 发布到 `https://npm.veren.top/`（时间取自 registry `@veren/app-host` 的 publish 记录，UTC）：

| 版本 | 发布时间（UTC） | 内容 |
| --- | --- | --- |
| 2.0.0 | 01:47 | 市场闭环版：全部 `@veren` 包统一 2.0.0，市场索引首次发布（commit `d04c5f9`） |
| 2.0.1 | 04:30 | 页面体系重构列车（page-body 自持首屏读取、标准 PageFC、应用目录收编工具） |
| 2.0.2 | 08:45 | 重构列车收尾（sub2api-admin 页面体注册全名工具、forum-app 模块级组件化等） |
| 2.0.3 | 09:18 | **真机修复列车**：本文件三个 bug 的修复 + 版本统一（commit `6bcc08a`） |

2.0.3 修复轮除三个 bug 外，还按同一安装链逻辑调整了依赖政策：`person-agent-bundle` 的工具构建器包改为对 app 的 runtime import，从 peerDependencies 移入 dependencies（pnpm v10 不自动安装 peer，peer 遗留会孤儿化导致 app 加载失败）；`app-host` 对 `app-registry`/`page-registry` 同理移入 dependencies。

### 53 清单与 registry 验证

- 发布闭包定义：`market/sources.txt` 列 10 个 bundle（startup-autostart-bundle、sub2api-admin-bundle、app-host-bundle、person-agent-bundle、forum-bundle、notebook-bundle、admin-app、web-login-gate、cms-bridge、session-fork-enhanced），`market/release.mjs` 按 `dependencies` 展开依赖闭包并拓扑排序（依赖先发），**闭包恰为 53 个包**——即「53 清单」。registry 已存在的版本自动跳过，重复执行安全。
- 本轮 registry 验证（只读 GET `https://npm.veren.top/@veren/<pkg>`）：本轮涉及的 app-host、app-host-bundle、notebook-app、person-agent-bundle、forum、forum-app、forum-ui、page-registry、sub2api-admin 的 2.0.0/2.0.1/2.0.2/2.0.3 版本序列全部在 registry 上可查，与列车时间线一致。
- **`@veren/task-workbench` 不在 53 清单内**（没有任何 bundle 依赖它，registry 上无此包）：它以 tarball 形式（`.tmp-plugin-packs/veren-task-workbench-2.0.3.tgz`）直装进稳定节点 web profile，并由 profile 级 `cordis.patch.yml` 的一行 insert（`id: task-workbench`）作为 profile 层加载——这是当前节点状态的既成事实，后续若要让任务工作台进市场，需把它收编进某个 bundle 的依赖（或独立 bundle 并加入 `sources.txt`）。
- 节点 profile 依赖快照（`deepseek/.dsh/profiles/web/package.json`）：六个 bundle + `prompt-page` 均 `^2.0.3`，task-workbench tarball 如上。

## 结论

三个真机 bug（notebook 服务绑定、Person Agent skills 隔离兜底、harness web 深链 404）全部修复并在稳定节点 3080 上验证通过；四应用（论坛、任务工作台、Person Agent、记事本）真机验收全绿；registry 发布链（53 清单、两轮列车）核对一致。2.0.3 具备作为市场交付版本的资格。
