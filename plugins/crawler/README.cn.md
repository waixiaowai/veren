# @veren/crawler

DSH 多平台内容采集插件 —— 面向学习研究场景，采集主流中文内容社区（小红书、抖音、快手、B 站、微博、贴吧、知乎）的公开内容与评论；所有人物标识在落地前强制匿名化，整形后的统一实体写入所选介质。

## 何时使用

- 需要以可控频率批量获取公开内容的结构化数据（关键词搜索 / 内容详情 / 创作者主页）。
- 需要把各平台异构数据整形为统一实体，并强制脱敏（创作者标识哈希化、昵称遮蔽）。
- 部署不采集社交内容时请跳过本插件。

## 当前进度（迭代 1）

按 `design/` 文档落地（总体规划见 `design/index.md`）：

- 共享契约：平台、模式、介质枚举、启动参数与统一实体（`src/types.ts`）。
- 全局错误码以结构化错误落地（`src/errors.ts`，对应 `design/errors.md`）。
- 采集任务状态机，非法转移显式拒绝（`src/task/state.ts`，对应 `design/states.md`）。
- 启动参数解析与校验：模式专属必填项、cookie 凭证、正整数守卫（`src/launcher/args.ts`）。
- 爬取器契约与平台注册表工厂：未知平台在采集开始前报错（`src/crawler/`）。
- 登录与凭证：三段式流程（探测→登录→持久化）+ 登录会话状态机，Cookie 注入必复验、凭证不落数据介质（`src/auth/`）。
- 控制服务核心：任务管理器（单任务互斥、停止超时强杀）、500 条日志环形缓冲、数据文件列表/预览/越界防护（`src/control/`）。
- HTTP 端点层：node:http 单端口后端，覆盖 api.md 的启停/状态/日志/数据（列表、预览、下载、统计）/配置/健康端点，错误按设计映射 400/403/404/500（`src/control/http-*.ts`）；ws-logs/ws-status 实时推送属后续迭代。
- 进程模型与入口集成：node 子进程运行器（环境净洗、日志泵、终止/强杀）、CLI 入口（单参数 JSON 进程约定）、插件 apply 装配任务管理器与控制服务器、卸载逆序清理（`src/runner/`、`src/cli.ts`、`src/index.ts`）。
- 采集引擎核心（平台无关）：并发信号量、限频分类与指数退避重试、统一翻页主循环（数量上限/空页终止/页间固定限频/单条失败隔离）（`src/crawler/semaphore.ts`、`ratelimit.ts`、`engine.ts`）。
- 缓存（外围域）：带过期时间的键值缓存抽象，内存后端（即时过期判断+后台周期清理），工厂分发未知类型报错（`src/cache/`）。
- 代理池（外围域）：IP 池随机抽取/池空重载/拉取重试三次、单活跃到期切换（30s 缓冲）、请求前刷新钩子（开关直通、失败保留旧代理）、双形态转换（`src/proxy/`）。
- 媒体下载（外围域）：串行落盘、候选地址链、.part 断点续传、零字节校验、文件名清洗/保留名/长度截断/目录穿越防护、扩展名白名单与推断优先级、DASH 分轨合流接缝（`src/media/`）。
- 浏览器自动化层：双模式启动器（CDP 接管优先、失败回退标准持久化启动）、Cookie 凭证串注入/回写转换、playwright-core 结构面注入可测试（`src/browser/`，依赖 `playwright-core`，不下载浏览器）。
- 平台爬取器骨架与首个平台：`BaseCrawler` 统一主流程（启动→探测/登录→采集→清理，先凭证后请求），`WbCrawler` 微博实现（无加密签名、搜索/详情/创作者三模式、长文补全、m.weibo.cn 解析）（`src/crawler/base.ts`、`src/platform/wb/`）。
- 全链路管线：启动请求 → 平台爬取器 → 存储数据汇（整形脱敏）→ 介质落盘 → 收尾，依赖全可注入；CLI 入口接真实浏览器会话与宿主 fetch（`src/pipeline.ts`、`src/sink.ts`）。
- 评论伴随采集与会话内取数：微博评论游标分页（comments/hotflow、数量上限）、上下文内接口请求自动携带登录态（`src/platform/wb/comments.ts`、`src/browser/context-fetch.ts`）。
- 组合包：`../crawler-bundle/`（配置-only，插入唯一 `crawler` 行，成员为普通依赖）——安装入口。
- 存储适配：脱敏（`store/mask.ts`）、整形（`store/shape.ts`）、文件介质 json/jsonl/csv（`store/`）、介质工厂。
- 插件入口与 schemastery 配置（`src/config.ts`）。

后续迭代（设计已定、代码未建）：浏览器自动化层、各平台爬取器、登录与凭证、媒体下载、代理池、缓存、词云、HTTP 控制服务、客户端面板页面。

## 开发

```bash
pnpm --filter @veren/crawler test       # 单元测试（vitest）
pnpm --filter @veren/crawler typecheck  # tsc --noEmit
pnpm --filter @veren/crawler build      # 产出 dist/
```

## 文档

- 英文文档：[README.md](./README.md)
- 设计方案：`plugins/crawler/design/`（中文，覆盖架构、模块契约、接口、权限、状态、数据字典、验收）
