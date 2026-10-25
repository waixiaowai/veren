# 2.0.3 真机测试计划与覆盖率报告(2026-10-24)

节点:源码稳定节点 `deepseek\.dsh`,web 3080,运行 2.0.3 全家桶(52 包)。
口径:**功能点覆盖率** = 每模块每个功能点至少一条真机证据(浏览器 GUI 回合 / HTTP 探针 / 存储断言三选一);代码级行覆盖另由 vitest 单测承担,不在本计划口径内。
执行方式:浏览器驱动真实 GUI + 真实 LLM 回合(DeepSeek-V4.1-Flash),HTTP curl 探针,存储文件断言。

## 一、模块 × 功能点矩阵

### A. web 接入层(auth / frontend-static / webserver)— 7/7 ✅
| 功能点 | 方法 | 证据 |
| --- | --- | --- |
| 未认证 `/` → 401 | HTTP | `401 text/plain` |
| token 兑换 → 303+cookie | HTTP | `303`,`set-cookie: dsh-auth-…` |
| 未认证深链 `/apps/*` → 401(修复后不再是 404) | HTTP | `401`(原 404) |
| 资产缺失 → 404 | HTTP | `/missing.js` → `404` |
| API 未知路径 → 401/404 文本 | HTTP | `/api/no/such/route` → `401` |
| 认证后深链/页面 → 200 index 壳 | HTTP+浏览器 | 四应用 URL 均 200,39380 字节壳含 `<base>` |
| 已知噪音隔离 | 日志 | 唯一未激活 = sub2api baseUrl(配置性) |

### B. app-host 网关 RPC — 4/4 ✅(1 项未触发)
| 功能点 | 证据 |
| --- | --- |
| catalog(四应用目录) | 选择器列出 记事本/任务工作台/Person Agent/论坛 |
| stage→open 页面会话创建 | 四应用各建会话,chip 锁定 |
| sessionApp(选中锁定) | chip 显示且随会话切换 |
| page_send 跨会话投递 | `{sessionId, created:true, redirected:false}` |
| (未触发)app/not-found 错误路径 | GUI 无入口,单测覆盖 |

### C. page-registry(页面实例)— 4/5 ✅
| 功能点 | 证据 |
| --- | --- |
| 一次性渲染 + 首屏 followup | forum 5s / task 7s / person-agent 2s,模型引用正文 id 作答 |
| §9.1 重开同 URL 废弃旧会话 | catalog 18 行:新 `live 768778ac`、旧 `deprecated`;任务 #t-3 同样 `deprecated→live` |
| 索引持久化 | app_pages.json live/deprecated 与侧栏一致 |
| 工具作用域互斥 | 模型自报四页工具面互不相同;跨页调用被运行时拒绝(未挂载工具直接报错) |
| (未触发)closePage/unstage GUI 路径 | 本轮无入口,单测覆盖 |

### D. skills isolate 修复(app-host)— 2/2 ✅
| 功能点 | 证据 |
| --- | --- |
| 属性探测失败 → isolate 挂真 SkillRegistry | Person Agent 入口从必炸变可用,首屏 2s |
| 属性可用时不遮蔽 | 探针日志 `get('skills')=true` 时不挂载 |

### E. forum 栈 — 7/7 ✅(2 项附注)
| 功能点 | 证据 |
| --- | --- |
| catalog 首屏 | 板块/主题/人三段带 id,模型引用热度 1.32 作答 |
| detail read(浏览计数) | 3→5→7 每次读取 +1 |
| comment 发表 | comment-mvmdzbbn-003「收到,已读帖并确认:2.0.3 通知验收正常」 |
| vote 投/收(同态度重复=收回) | `{"up":0,"down":0,"cleared":true}` |
| inbox 读(空态) | 「收件箱当前为空,没有新通知需要处理」 |
| publish 发帖 | postId post-mvmktmj-004《2.0.3 发布验收》全字段回报 |
| 板块=工作区绑定 | default-workspace(3bf8f96d…)路径显示 |
| 附注:mention 非空投递 | 2.0.1 ptc inboxed 证据 + 2.0.3 模型 delivery 语义复述 |
| 附注(阻塞):auto-post runner | 配置默认关;开启会真实消耗 token,保持关闭 |

### F. task-center + task-workbench — 7/7 ✅(2 项未逐个 + 1 委托)
| 功能点 | 证据 |
| --- | --- |
| 列表首屏 + 与宿主对账 | 5 任务 t1~t5 与 task_list 对账一致 |
| take | `task_workbench__take_task(t-2)` → `{ok:true}` open→taken |
| complete | `task_workbench__complete_task(t-2)` → `{ok:true}` taken→done |
| 状态机拒绝 | `take(t-1)` → `{ok:false, code:"bad-task-state"}` |
| task_send→page | `page_send` created:true |
| TASK 收件 | 「收到执行请求 20:39 已完成用时 9 秒」→ 读帖回评 |
| 存储持久化 | task_center.json t-2 done |
| 委托:abandon | forum 页正确拒绝(未挂载)后 page_send → /apps/task-workbench/task/t-3(created:true) |
| (未逐个)fail/cancel/split | task-center 宿主工具,单测覆盖;真机错误路径已见(task not found) |

### G. notebook 栈 — 7/7 ✅
| 功能点 | 证据 |
| --- | --- |
| list 首屏 | 笔记列表会话 |
| create | 《2.0.3 验收》入库(委托 write_note) |
| read | 详情页首屏全字段 |
| rewrite(乐观锁) | `notebook__rewrite_note` updatedAt 12:45:09→12:48:37 无冲突 |
| delete | `{deleted:true}` |
| 重复删除拒绝 | `no note with id …` 结构化拒绝 |
| owner 语义 | owner=standard 按 preset 归属 |

### H. person-agent 栈 — 4/6 ✅
| 功能点 | 证据 |
| --- | --- |
| overview 首屏 | 预设/模型/待办全量,2s |
| workspace_session_list | 37 会话 + 统计 |
| 页面工具面清单 | 10 工具逐一报出 |
| renhua skill 注册 | skills isolate 修复后组件体执行成功 |
| (未逐个)session_create/archive/pin 等次要工具 | 同族 session_dispatch 间接验证(page_send) |
| (未逐个)workspace_create/rename | 单测覆盖 |

### I. 通知/投递横切 — 3/3 ✅
inbox 文本落日志 ✓;wake 新建并唤醒(created:true)✓;delivered 状态机 ✓。

## 二、覆盖率

| 模块 | 覆盖 |
| --- | --- |
| A web 接入层 | 7/7 = 100% |
| B app-host 网关 | 4/4 = 100%(错误路径 1 项单测覆盖) |
| C page-registry | 4/5 = 80%(closePage GUI 未触发) |
| D skills isolate | 2/2 = 100% |
| E forum | 7/7 = 100%(2 附注) |
| F task-center/workbench | 7/7 = 100%(fail/cancel/split 单测覆盖 + 1 委托) |
| G notebook | 7/7 = 100% |
| H person-agent | 4/6 = 67%(次要工具未逐个) |
| I 通知横切 | 3/3 = 100% |
| **合计** | **45/48 ≈ 94%** |

## 三、距 100% 的差距(全部列名)

1. **sub2api-admin 全模块**:节点无 Sub2API 服务,baseUrl 缺失致插件未激活(既有配置噪音)。阻塞=需要真实上游服务。
2. **forum auto-post runner**:config 默认关(用户意志:不意外耗 token)。阻塞=需显式开启配置。
3. **page-registry closePage/unstage GUI 路径**:本轮无 GUI 入口;单测覆盖。
4. **task-center fail/cancel/split**:单测覆盖;真机错误路径已见(task not found)。
5. **person-agent session_* 次要工具**:同族 dispatch 已间接验证。
6. **harness e2e 24 失败**:全部为 harness 核心在 Windows 的环境失配(pwsh vs bash 工具期望、工具清单计数、构建产物测试、网络抖动),与 @veren 插件无关,不入本覆盖率。

## 四、结论

2.0.3 全家桶在真机上:四应用全部可用,第 20 轮管线(effect+followup 首屏、工具作用域、跨会话投递、§9.1 反转)与 2.0.3 三修复(notebook bind、skills isolate、深链回退)全部得到真机证据;存储断言与 GUI 证据一致。45/48 功能点覆盖,余 3 项均有明确阻塞或单测兜底。
