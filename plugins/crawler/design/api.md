---
title: 服务端接口
description: 控制服务对控制台面板的全部接口定义。
sidebar:
  order: 3
lastUpdated: 2026-11-04
---

控制服务的全部对外接口如下。命令行入口不设接口（进程调用即接口），数据库与代理服务商属被调用方，均不在此列。接口统一挂 `/api` 前缀，除 WebSocket 外均为 JSON 请求与响应。

## 1. Endpoint List

| 标识 | 路径 | 方法 | 用途 | 认证 |
| --- | --- | --- | --- | --- |
| crawler-start | /api/crawler/start | POST | 启动采集任务 | 无（本机使用） |
| crawler-stop | /api/crawler/stop | POST | 停止运行中任务 | 无 |
| crawler-status | /api/crawler/status | GET | 查询任务状态 | 无 |
| crawler-logs | /api/crawler/logs | GET | 查询历史日志 | 无 |
| ws-logs | /api/ws/logs | WS | 日志实时推送 | 无 |
| ws-status | /api/ws/status | WS | 状态每秒推送 | 无 |
| data-files | /api/data/files | GET | 列出数据文件 | 无 |
| data-file | /api/data/files/{path} | GET | 预览或返回文件 | 无 |
| data-download | /api/data/download/{path} | GET | 下载文件 | 无 |
| data-stats | /api/data/stats | GET | 数据统计 | 无 |
| env-check | /api/env/check | GET | 环境可用性检查 | 无 |
| config-platforms | /api/config/platforms | GET | 平台列表 | 无 |
| config-options | /api/config/options | GET | 配置枚举项 | 无 |
| health | /api/health | GET | 服务健康检查 | 无 |

> **注意**：控制服务定位为单机本地面板后端，不设账号体系，认证一栏统一为无。该边界记录于[校验记录](./review/)，若改为多人使用必须先补认证层。

## 2. crawler-start

启动采集任务。运行中重复启动返回失败语义（HTTP 400，错误码见[错误码](./errors/)）。

- 请求体（全部字段必填性见[启动器契约](./modules/launcher/)）：

| 字段 | 类型 | 必填 | 校验 | 示例 |
| --- | --- | --- | --- | --- |
| platform | string | 是 | 七平台枚举 | `"xhs"` |
| loginType | string | 是 | qrcode/phone/cookie | `"qrcode"` |
| crawlerType | string | 是 | search/detail/creator | `"search"` |
| keywords | string[] | 搜索模式必填 | 非空 | `["美食"]` |
| specifiedIds | string[] | 详情模式必填 | 内容 id | `["abc123"]` |
| creatorIds | string[] | 创作者模式必填 | 创作者标识 | `["u1"]` |
| enableComments | boolean | 是 | — | `true` |
| enableSubComments | boolean | 是 | — | `false` |
| enableMedia | boolean | 是 | — | `false` |
| saveOption | string | 是 | 八介质枚举 | `"jsonl"` |
| cookies | string \| null | cookie 方式必填 | 凭证串 | `"web_session=..."` |
| headless | boolean | 是 | — | `false` |
| maxNotesCount | number | 是 | 正整数 | `20` |
| maxCommentsCount | number | 是 | 正整数 | `10` |
| startPage | number | 是 | 正整数，默认 1 | `1` |

- 响应：`{ "status": "started" | "rejected", "message": string }`。
- 错误：CRAWLER_ALREADY_RUNNING（400）、INVALID_ARGUMENT（400）。

## 3. crawler-stop

停止运行中任务。响应 `{ "status": "stopped" | "not_running", "message": string }`。超时强杀对调用方透明，返回同样的成功语义。错误：CRAWLER_NOT_RUNNING（200 语义响应，非 HTTP 错误）。

## 4. crawler-status

查询任务状态。响应即[控制服务契约](./modules/api/)中的状态对象：状态枚举、平台、模式、启动时间、错误信息。

## 5. crawler-logs

查询历史日志。参数：`limit`（query，默认 100，上限为缓冲容量 500）。响应 `{ "logs": LogEntry[] }`，按时间升序。

## 6. Log and Status Streams

本节覆盖 ws-logs 与 ws-status 两个 WebSocket 通道。

- ws-logs：连接建立后先补发历史日志再进入实时推送；心跳以 ping/pong 保活。
- ws-status：每秒推送一次状态对象，结构与 crawler-status 响应一致。

## 7. data-files

列出数据文件。参数：`platform`（query，可选，七平台枚举）、`file_type`（query，可选，json/csv/excel）。响应 `{ "files": [{ "name", "path", "size", "modified_at", "record_count", "type" }] }`。

## 8. data-file

预览或返回文件。参数：`path`（路径参数，数据目录内相对路径）、`preview`（query，默认 false）、`limit`（query，预览行数上限，默认 100）。

- preview=true：`{ "data": object[], "total": number, "columns"?: string[] }`。
- preview=false：直接返回文件内容（相应内容类型）。
- 错误：DATA_PATH_OUT_OF_ROOT（403）、DATA_FILE_NOT_FOUND（404）。

## 9. Auxiliary Endpoints

本节覆盖 data-download、data-stats、env-check、config-platforms、config-options、health 六个简单接口。

- data-download：以附件形式下载文件。错误同 data-file。
- data-stats：`{ "total_files", "total_size", "by_platform", "by_type" }`。
- env-check：执行入口命令帮助输出验证环境，30 秒超时；`{ "ok": boolean, "message": string }`。
- config-platforms：`{ "platforms": [{ "value", "label" }] }`，七个平台。
- config-options：`{ "login_types", "crawler_types", "save_options" }`，三组枚举。
- health：`{ "status": "ok" }`。

接口与模块契约的一致性：请求体字段与[控制服务契约](./modules/api/)的启动请求一一对应，枚举值与[启动器契约](./modules/launcher/)一致，错误语义统一引用[错误码](./errors/)。
