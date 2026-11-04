---
name: crawler
description: Use when the user asks to collect public contents or comments from Chinese content communities (xhs/dy/ks/bili/wb/tieba/zhihu) — keyword search, content detail, or creator mode — or asks about crawl task status, collected data, or a failed crawl; covers the crawler__ tools, the single-task mutex, the login requirement (cookie/qrcode), and rate-limit etiquette. Skip it for posting, commenting, or any interaction on those platforms — the crawler is strictly read-only.
---

# 多平台内容采集使用指导 / Content-crawler usage guide

## 何时用 / When to use

用户要求采集中文内容社区（小红书 xhs、抖音 dy、快手 ks、B 站 bili、微博 wb、贴吧 tieba、知乎 zhihu；当前已接入 wb/tieba/bili/xhs/zhihu 五平台）的**公开**内容或评论（关键词搜索 / 内容详情 / 创作者主页），或询问采集任务状态、已采数据、失败原因时使用本技能。

**绝不用于**在这些平台发布、评论、点赞或任何互动——采集器严格只读。

## 工具 / Tools

全部工具（六个）以 `crawler__` 为前缀：

- `crawler__start` — 启动采集任务。参数：`platform`（必填，七平台枚举）、`crawlerType`（search/detail/creator，必填）；`enableMedia`（可选，开启图片/视频下载落盘）、`keywords`（search 模式必填非空）、`specifiedIds`（detail 模式必填）、`creatorIds`（creator 模式必填）、**单任务互斥**：已有任务运行中再启动会被拒绝，先 `crawler__status` 查看再决定是否 `crawler__stop`。
- `crawler__stop` — 停止运行中任务（优雅终止，超时强杀；空闲时返回 not_running）。
- `crawler__status` — 任务状态机快照：idle/starting/running/stopping/error + 平台、模式、起始时刻、错误信息。
- `crawler__logs` — 日志环形缓冲尾部（默认 50 条），失败时用它看每页进度或失败原因。
- `crawler__data` — 存储域数据汇总（contents/comments 总量与按平台计数；可选 `platform` 参数过滤到单平台）。
- `crawler__wordcloud` — 词频表（可选 `platform` 参数过滤到单平台；可选 `topK` 参数控制返回条数）（从存储域评论计算，中文二元/英文词元 + 停用词过滤）；供总结评论话题或喂外部词云渲染器。

## 数据存储 / Storage

- 数据只写**宿主存储域** `crawler` 域（contents/comments 两表），按业务主键 upsert，重跑幂等。启动请求无介质参数——存储由宿主统一管理。
- 媒体开关开启时，图片/视频按目录规则落盘（数据根/平台/media/内容ID/）。

## 登录 / Login

采集依赖目标平台登录态：`cookie` 方式需要用户先提供 Cookie 串（配置或接口传入）；`qrcode`/`phone` 方式需要用户交互完成扫码。登录探测失败且登录被放弃时，**不会发出任何业务请求**——不要在未登录状态下反复重试。

## 失败处理 / Failure handling

- `RATE_LIMITED`：已自动退避重试，重试耗尽后任务转 error——建议稍后再试或减小数量上限。
- `IP_BLOCKED` / `PLATFORM_ACCESS_DENIED`：直接终止，建议配置代理。
- `CREDENTIAL_INVALID`：Cookie 失效，请用户重新提供。
- 任务 error 态后需人工复位（再次 start 即复位语义）。

## 合规 / Compliance

只采集公开数据；人物标识落地前强制匿名化（创作者标识哈希化、昵称遮蔽）——任何介质里都不会出现可识别个人的明文字段。使用者对采集行为的合规性负责。
