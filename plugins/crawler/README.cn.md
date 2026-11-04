# @veren/crawler

DSH 多平台内容采集插件 —— 面向学习研究场景，采集主流中文内容社区（小红书、抖音、快手、B 站、微博、贴吧、知乎）的公开内容与评论；所有人物标识在落地前强制匿名化，整形后的统一实体写入**宿主存储域**（dsh storageDomain，本插件唯一的存储介质）。

## 何时使用

- 需要以可控频率批量获取公开内容的结构化数据（关键词搜索 / 内容详情 / 创作者主页）。
- 需要把各平台异构数据整形为统一实体，并强制脱敏（创作者标识哈希化、昵称遮蔽）。
- 部署不采集社交内容时请跳过本插件。

## 架构（集成形态）

- **存储只认宿主 storageDomain**：数据按业务主键 upsert 进 `crawler` 域（contents/comments 两表），重跑幂等；文件与数据库介质归 dsh 其他插件（用户指令）。
- **采集在宿主进程内运行**（存储域访问要求），协作式取消；控制 API 挂在宿主 web 服务器上（`ctx.webServer.register`，不启动独立端口）。
- **浏览器 CDP 接管优先**（保留真实指纹与登录态），失败回退系统 Chrome 标准持久化启动。
- **登录前置铁律**：探测→登录→持久化；未登录绝不发出业务请求。

## 已实现

- 平台爬取器：**wb**（真机验证：双站 Cookie 登录、搜索/详情/创作者、评论伴随、长文补全）、**tieba**（真机验证：免登录 JSON 通道、搜索+评论伴随+媒体下载真机落库 20+/26 条）、**bili**（纯算法 WBI 签名，代码+测试完成，Cookie 预热调试中）
- 登录与凭证：三段式（探测→登录→持久化）+ 登录会话状态机，Cookie 注入必复验
- 存储适配：整形脱敏（SHA-256 哈希 + 昵称遮蔽）→ 宿主存储域
- 引擎：并发信号量、限频退避、统一翻页循环（上限/空页终止/单条失败隔离/协作取消）
- 控制服务：任务管理器（单任务互斥、停止超时强杀）、日志环形缓冲、`/api/data/domain` 只读数据面、**ws-logs/ws-status** 推送通道（宿主 `registerUpgrade` + 最小 RFC6455）
- 工具与技能：`crawler__start/stop/status/logs/data` 五工具 + bundled 技能 `crawler`（使用指导）
- 客户端入口：应用 `crawler`（`/apps/crawler/overview` 总览页）
- 词云：词频表数据源（中文二元/英文词元 + 停用词；渲染归外部工具）

## 安装

经 [`../crawler-bundle/`](../crawler-bundle)（配置-only 组合包）安装到 profile；技能行独立，无 `skills` 服务的 profile 仅技能行 pending。

## 开发

```bash
pnpm --filter @veren/crawler test       # 单元测试（vitest）
pnpm --filter @veren/crawler typecheck  # tsc --noEmit
pnpm --filter @veren/crawler build      # 产出 dist/
```

## 文档

- 英文文档：[README.md](./README.md)
- 设计方案：`design/`（架构、模块契约、接口、权限、状态、数据字典、验收）
- 实现决策记录：`design/implementation-decisions.md`
