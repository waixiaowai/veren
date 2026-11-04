---
title: 实现决策记录
description: 实现相对设计文档的偏离与宿主集成决策的权威清单。
sidebar:
  order: 99
  label: 实现决策记录
---

本附录是设计文档与实现之间的**权威偏离清单**：凡实现与正文设计不一致处，以本文件记录的决策为准；正文保留原始设计供追溯。

## 1. 存储只认宿主 storageDomain（用户指令）

正文设计的八介质枚举（csv/db/json/jsonl/sqlite/mongodb/excel/postgres）**不实现**：文件与数据库存储归 dsh 其他插件，本插件只写宿主存储域。

- 统一实体 upsert 进 `crawler` 域（contents/comments 两表），键为「平台::业务主键」，重跑幂等。
- `saveOption` 字段从启动请求、工具参数与配置中移除；`StoreSink` 直连存储域，域未开 fail loud（`DB_CONNECT_FAILED`）。
- 词云旁路随文件介质一起移除；词频表纯函数保留（`src/wordcloud.ts`），渲染归外部工具。

## 2. 控制服务挂宿主 web 服务器（用户指令）

正文设计的独立端口 HTTP 服务**不实现**：全部端点经 `ctx.webServer.register` 前缀注册挂到宿主服务器（`/api/crawler`、`/api/data/domain`、`/api/config`、`/api/health`），卸载逆序清理。

- 正文的数据文件系列端点（files/preview/download/stats）随文件介质移除；新增 `/api/data/domain` 存储域只读数据面。
- ws-logs/ws-status 经宿主 `registerUpgrade` 实现（最小 RFC6455 服务端）；宿主不支持 upgrade 时跳过，轮询端点兜底。
- 子进程 CLI（正文「控制服务以子进程包装命令行入口」）随文件介质移除：存储域要求采集在宿主进程内运行，`runner/inprocess-runner` 以协作式取消承接启停语义（进程内无强杀）。

## 3. 浏览器 CDP 接管优先

正文已定，实现补充：系统浏览器渠道可配（`chrome`/`msedge`）；导航统一 `domcontentloaded`（规避慢资源 `load` 挂起）；会话内取数经适配器（自动携带登录 Cookie，非 JSON 响应折成 `PLATFORM_ACCESS_DENIED`）。

## 4. 平台登录注册表

未接入登录的平台 fail loud（`INVALID_PLATFORM`），管线绝不带「假装已登录」状态采集。当前接入：wb（双站 Cookie 全套）、tieba（公共免登录通道，探测恒命中）、bili（免登录搜索通道，探测恒命中）。

## 5. 平台接入进度

| 平台 | 状态 | 签名路线（正文 §列表） |
| --- | --- | --- |
| wb | ✅ 真机验证 | 无加密签名 |
| tieba | ✅ 真机验证 | 无加密签名（免登录 JSON 通道） |
| bili | 代码+测试完成；真机调试受阻于反爬 | 纯算法 WBI 签名（Cookie 预热调试中） |

**bili 真机调试记录（2026-11-04）**：① 空结果集静默返回 → 已修复为业务码显式上抛（`RATE_LIMITED`，引擎退避接管）；② 增加 `finger/spi` Cookie 预热（buvid 激活先于签名搜索）；③ 当前阻塞点为更深层反爬：headless Chrome 临时档案访问 bilibili 首页即 `ERR_CONNECTION_CLOSED`——下一步需真实用户档案/可见窗口/已登录 Cookie，超出无人值守调试边界。
| xhs / dy / ks / zhihu | 未接入 | 本地算法库 / 本地脚本引擎 / 浏览器内捕获 |

## 6. 运行时观测增强（相对正文的补充）

- 采集收尾如实报数（0 条也要说出来——静默空结果是最难查的故障）。
- B 站业务码非零折成 `RATE_LIMITED` 上抛（引擎退避重试接管），不静默吞成空页。
- 任务状态机、日志环形缓冲、登录会话状态机与正文一致；存储域数据面 `/api/data/domain` 为正文的补充端点。
