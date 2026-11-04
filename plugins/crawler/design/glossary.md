---
title: 名词表
description: 业务名词与技术术语分开解释。
sidebar:
  order: 12
lastUpdated: 2026-11-04
---

业务名词与技术术语分开列出；只收录正文使用过的词。

## 1. Business Terms

| 中文名 | 统一标识 | 解释 | 易混淆边界 |
| --- | --- | --- | --- |
| 采集任务 | Crawler Task | 一次由使用者下发的采集执行单位，单机同一时刻至多一个 | 任务 ≠ 进程：任务状态是控制服务视角的抽象，进程是其载体 |
| 采集模式 | Crawler Type | search（关键词搜索）/ detail（指定内容详情）/ creator（创作者主页）三种 | detail 需要内容 id，creator 需要创作者标识，输入互不相同 |
| 登录会话 | Login Session | 某平台上以 Cookie 代表的采集身份 | 会话切换会覆盖档案，但不影响其他平台的会话 |
| 登录方式 | Login Type | qrcode / phone / cookie 三种取得会话的途径 | phone 在部分平台不可用，见平台差异说明 |
| 内容实体 | Content | 被采集的帖子、视频、问答等内容主对象 | 评论不是内容；评论归属内容 |
| 评论实体 | Comment | 内容下的评论，含一级与二级 | 二级评论通过 parent_comment_id 关联一级评论 |
| 介质 | Save Data Option | 数据落地方式：csv/json/jsonl/sqlite/db/mongodb/excel/postgres | db 与 postgres 同走关系库实现；excel 全量驻内存 |
| 数据产物 | Data Artifact | 数据文件、Excel、媒体文件、词云图的统称 | 登录档案不是数据产物，属凭证专用目录 |
| 访问令牌 | Access Token | 部分平台详情与评论请求要求的随行参数 | 随搜索结果带出并随内容入库，缺失则详情不可得 |
| 来源关键词 | Source Keyword | 产生该条数据的搜索词，随数据落地 | 与请求上下文中的当前关键词是同一来源的两个用途 |
| 匿名哈希 | Creator Hash | 创作者标识经哈希截断后的脱敏形态 | 是唯一允许落地的人物标识形态，明文 id 禁止落地 |
| 遮蔽昵称 | Masked Nickname | 首尾各保留一字、中间星号的昵称形态 | 与匿名哈希配套使用，二者都不可逆 |

## 2. Technical Terms

| 术语 | 解释 | 在本方案中的用途 |
| --- | --- | --- |
| CDP | Chrome DevTools Protocol，浏览器远程调试协议 | 接管使用者已装浏览器的默认通道 |
| Playwright | 浏览器自动化框架 | 页面操作、登录交互与页面内取数的执行层 |
| 签名器 | Sign Provider | 按平台机制产出请求签名头或参数的组件抽象 |
| 翻页游标 | Pagination Cursor | 页码、游标、会话串联三种翻页形态的统称 |
| 信号量并发 | Semaphore Concurrency | 以配置值约束详情与评论任务并发度的机制 |
| 单活跃代理 | Single Active Proxy | 池中同一时刻只有一个出口 IP 生效、到期切换的模式 |
| 退避重试 | Backoff Retry | 失败后按递增间隔重试的策略，用于限频与下载 |
| 断点续传 | Resumable Download | 分片临时文件加范围请求的续传下载方式 |
| 分轨合流 | DASH Merge | 音视频分离下载后合流为单一文件 |
| 隐身注入 | Stealth Injection | 页面加载前注入脚本以降低自动化特征 |
| 会话内取数 | In-page Fetch | 以页面内执行请求的方式获取接口数据，绕过直连限制 |
| 主键幂等更新 | Idempotent Upsert | 按业务主键存在即更新、否则插入的写入语义 |
| 双检锁单例 | Double-checked Singleton | 连接对象按需建立且仅建立一次的惯用法 |
| 环形缓冲 | Ring Buffer | 日志内存缓冲的固定容量淘汰策略 |
| 贴底跟随 | Follow Bottom | 终端日志区滚动到底部时新日志自动跟随的行为 |
