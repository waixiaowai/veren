---
title: 数据字典
description: 十三个实体的字段、类型与可见性。
sidebar:
  order: 8
---
## 7. Data Dictionary

数据字典是字段定义的唯一来源：模块契约引用这里的字段名与类型，不再另定义。字段标识采用接口传输名（小写下划线）；组件与契约层的驼峰写法按"下划线转驼峰"一一对应（如 `saved_path` 对应 `savedPath`），不做语义改写。

全局约定：时间为 ISO 8601 带时区（`2026-03-16T10:30:00+08:00`），服务端返回的 Unix 秒在归一化时转换；大小单位为字节（整数）；文件标识一律以字符串传输，避免大整数精度丢失；分页从 1 开始；路径为服务端形式（`/apps/bdpan/...`），面向用户的展示路径由 `displayPath` 规则派生。

### 7.1 Entities

| 实体 | 说明 | 归属 | 主要出现位置 |
|---|---|---|---|
| account | 账号资料与会员身份 | 外部账号服务 | CLI-WHOAMI、MCP-USER-INFO、SDK-PROFILE |
| token_credential | 访问令牌与刷新令牌 | guard | 本机凭据库（不对外输出） |
| file_entry | 文件或目录条目 | 外部存储服务 | CLI-LS、CLI-SEARCH、MCP-FILE-LIST、SDK-LIST |
| quota_snapshot | 账号容量快照 | 外部账号服务 | CLI-QUOTA、MCP-QUOTA、SDK-QUOTA |
| upload_result | 上传结果 | command、client | CLI-UPLOAD、SDK-UPLOAD |
| transfer_task | 转存任务 | 转存服务 | CLI-TRANSFER、CLI-TRANSFER-SELECT |
| content_item | 正文条目 | 正文服务 | CLI-GET-CONTENT、CLI-GET-CONTENT-RESULT |
| parse_task | 解析任务 | 正文服务 | CLI-GET-CONTENT-RESULT |
| search_hit | 正文命中 | 正文服务 | CLI-SEARCH-CONTENT |
| share_link | 分享链接 | 转存服务 | CLI-SHARE、MCP-SHARE-CREATE |
| agent_context | 会话归因上下文 | 宿主 | 全部命令接口 |
| memory_manifest | 记忆备份清单 | memory | 备份目录 |
| version_contract | 技能与命令版本契约 | delivery | 技能包元数据 |

### 7.2 Fields

#### 7.2.1 Account

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `uid` | string | 是 | 十进制整数串 | — | — | 账号 | 内部 |
| `baidu_name` | string | 是 | 账号显示名 | — | — | 账号 | 用户可见 |
| `avatar_url` | string | 否 | HTTPS 地址 | 空串 | — | 账号 | 用户可见 |
| `vip_type` | integer | 是 | 0 普通、1 会员、2 超级会员 | 0 | — | 账号 | 用户可见 |
| `is_svip` | boolean \| null | 否 | 已识别会员类型时给出 | null | — | 账号 | 用户可见 |
| `entitlement_status` | string | 是 | `known` / `unknown` | `unknown` | — | 账号 | 内部（用于判断预检） |

`entitlement_status=unknown` 不表示非会员，只表示当前无法判定；正文检索的预检必须据此暂停而不是拒绝。

#### 7.2.2 Token Credential

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `account_ref` | string | 是 | 不透明账号引用，可在日志出现 | — | — | 账号 | 内部 |
| `access_token` | string | 是 | 不透明令牌 | — | — | 账号 | 机密（禁止输出） |
| `refresh_token` | string | 是 | 不透明令牌 | — | — | 账号 | 机密（禁止输出） |
| `expires_at` | string | 是 | ISO 8601 | — | — | 账号 | 内部；仅到期时间可展示 |
| `scope` | string | 是 | 授权范围，逗号分隔 | — | — | 账号 | 内部 |

#### 7.2.3 File Entry

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `fsid` | string | 是 | 十进制整数串（兼容 `fs_id` 数值） | — | — | 账号 | 内部（用户索要时才给出） |
| `path` | string | 是 | `/apps/bdpan/...` | — | — | 沙盒 | 内部；展示时映射 |
| `server_filename` | string | 是 | 文件名，可含连续点号 | — | — | 沙盒 | 用户可见 |
| `saved_path` | string | 否 | `我的应用数据/bdpan/...` | 由 `path` 派生 | — | 沙盒 | 用户可见 |
| `size` | integer | 是 | ≥0；目录为 0 | 0 | 字节 | 沙盒 | 用户可见（格式化后） |
| `isdir` | boolean | 是 | `true` / `false` | false | — | 沙盒 | 用户可见 |
| `md5` | string | 是 | 32 位十六进制；目录为空串 | 空串 | — | 沙盒 | 内部 |
| `category` | integer | 是 | 0–7：视频 1、音频 2、图片 3、文档 4、应用 5、其他 6、种子 7 | 0 | — | 沙盒 | 用户可见（可选） |
| `server_mtime` | string | 是 | ISO 8601 | — | — | 沙盒 | 用户可见 |
| `server_ctime` | string | 是 | ISO 8601 | — | — | 沙盒 | 用户可见（可选） |
| `return_url` | string | 否 | 不透明链接，禁止拼接 | — | — | 账号 | 用户可见（点击） |
| `return_markdown` | string | 否 | 预渲染的查看链接（Markdown 形式） | — | — | 账号 | 用户可见 |
| `return_hint` | string | 否 | 当前固定"点击查看" | `点击查看` | — | 账号 | 用户可见 |
| `return_target_type` | string | 否 | `directory` / `file_preview` | `directory` | — | 账号 | 内部 |
| `client_return_target_type` | string | 否 | `file` / `directory` | `file` | — | 账号 | 内部 |

#### 7.2.4 Quota Snapshot

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `total_bytes` | integer | 是 | >0；≤0 视为异常 | — | 字节 | 账号 | 用户可见 |
| `used_bytes` | integer | 是 | ≥0 | — | 字节 | 账号 | 用户可见 |
| `free_bytes` | integer | 是 | max(total-used, 0) | — | 字节 | 账号 | 用户可见 |
| `usage_ratio` | number | 是 | 0–1 | — | — | 账号 | 内部 |
| `usage_percent` | number | 是 | 0–100，两位小数 | — | % | 账号 | 用户可见 |
| `total_display` / `used_display` / `free_display` | string | 是 | 1024 进制，单位 B/KiB/MiB/GiB/TiB | — | — | 账号 | 用户可见 |
| `expire` | boolean | 是 | 是否 7 天内有容量到期 | false | — | 账号 | 用户可见 |
| `message` | string | 是 | 状态说明 | — | — | 账号 | 用户可见 |

#### 7.2.5 Upload Result

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `action` | string | 是 | `created` / `renamed` / `overwritten` / `unchanged` / `unknown` | — | — | 沙盒 | 用户可见（转述） |
| `requested_path` | string | 是 | 请求目标（服务端形式） | — | — | 沙盒 | 内部 |
| `saved_path` | string | 是 | 实际落点（展示形式） | — | — | 沙盒 | 用户可见 |
| `remote_path` | string | 是 | 兼容字段，相对授权根 | — | — | 沙盒 | 内部 |
| `conflict_detected` | boolean | 是 | 预检是否发现同名 | false | — | 沙盒 | 内部 |
| `verification` | string | 是 | 当前固定 `metadata` | `metadata` | — | 沙盒 | 内部 |
| `content_verified` | boolean | 是 | 当前固定 `false` | false | — | 沙盒 | 内部 |
| `fsid` | string | 是 | 文件标识 | — | — | 沙盒 | 内部 |
| `return_markdown` | string | 否 | 预渲染链接 | — | — | 账号 | 用户可见 |

#### 7.2.6 Transfer Task

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `status` | string | 是 | `submitted` / `running` / `succeeded` / `partial` / `failed` / `unknown` | — | — | 账号 | 用户可见（转述） |
| `task_id` | string | 条件 | `status` 为 `submitted`/`running`/`unknown` 时必填 | — | — | 账号 | 内部 |
| `saved_path` | string | 条件 | 完成时给出共同目标目录 | — | — | 沙盒 | 用户可见 |
| `count` | integer | 条件 | 完成文件数 | 0 | 个 | 沙盒 | 用户可见 |
| `files[]` | array | 条件 | 每项含 `saved_path`、`fsid`、`size`、`is_dir`、`return_markdown` | 空数组 | — | 沙盒 | 用户可见（逐项） |

#### 7.2.7 Content and Parse

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `fsid` | string | 是 | 文件标识 | — | — | 沙盒 | 内部 |
| `name` | string | 是 | 文件名 | — | — | 沙盒 | 用户可见 |
| `path` | string | 是 | 服务端路径 | — | — | 沙盒 | 内部 |
| `content` | string | 否 | 正文；超长或异步时为缺省 | — | — | 沙盒 | 用户可见 |
| `url` | string | 否 | 签名下载地址，2 小时有效 | — | — | 沙盒 | 用户可见（临时） |
| `task_id` | string | 否 | 解析任务号 | — | — | 账号 | 内部 |
| `page_start` / `page_end` | integer | 否 | ≥1；实际读取范围 | — | 页 | 沙盒 | 用户可见 |
| `page_num` | integer | 否 | 文档总页数 | — | 页 | 沙盒 | 用户可见 |
| `char_count` | integer | 否 | 正文完整字数 | — | 字 | 沙盒 | 内部 |
| `truncated` | boolean | 否 | 是否因 50 万字上限被截断 | false | — | 沙盒 | 用户可见（需说明） |
| `error` | string | 否 | 该项失败原因（含"（错误码 N）"后缀） | — | — | 沙盒 | 用户可见（转述） |
| `return_markdown` | string | 否 | 预渲染链接 | — | — | 账号 | 用户可见 |

parse_task 为对象形态（与 content 数组不同）：`task_id`、`status`（`running`/`succeeded`/`partial`/`failed`）、`files[]`（字段同上）。

#### 7.2.8 Search Hit

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `fsid` | string | 是 | 文件标识 | — | — | 沙盒 | 内部 |
| `file_name` | string | 是 | 文件名 | — | — | 沙盒 | 用户可见 |
| `path` | string | 是 | 服务端路径 | — | — | 沙盒 | 内部 |
| `snippet` | string | 是 | 命中片段；可能是"索引生成中"占位 | — | — | 沙盒 | 用户可见（需甄别） |
| `file_url` | string | 是 | 本命令唯一链接字段 | — | — | 账号 | 用户可见（点击） |
| `file_url_target` | string | 否 | `file` / `directory` | `file` | — | 账号 | 内部 |
| `source_ref_id` | string | 是 | 片段与来源的匹配键，不跨请求复用 | — | — | 账号 | 内部 |
| `pid` | string | 否 | 不透明片段标识，不是页码 | — | — | 账号 | 内部 |
| `locator` | string \| null | 是 | 当前恒为 null | null | — | 沙盒 | 内部 |

#### 7.2.9 Share Link

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `link` | string | 是 | 分享链接 | — | — | 账号 | 用户可见 |
| `short_url` | string | 是 | 短链标识 | — | — | 账号 | 用户可见（可选） |
| `share_id` | integer | 是 | 分享标识 | — | — | 账号 | 内部 |
| `period` | integer | 是 | 0/1/7/30 | 7 | 天 | 账号 | 用户可见 |
| `pwd` | string | 是 | 4 位，数字加小写字母 | — | — | 账号 | 用户可见 |

#### 7.2.10 Context and Manifest

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `agentname` | string | 否 | 宿主名称 | — | — | 会话 | 内部 |
| `session_input` | string | 否 | 本轮用户原文，逐字 | — | — | 会话 | 内部（禁止回显敏感内容） |
| `session_id` | string | 否 | `{unix秒}-{6位随机}` | — | — | 会话 | 内部 |
| `uid` / `traceid` | string | 否 | 宿主注入的归因标识 | — | — | 集成 | 内部 |
| `version` | string | 是 | 清单版本，当前 `2.0` | — | — | 账号 | 内部 |
| `agent` | string | 是 | 四类宿主之一 | — | — | 账号 | 内部 |
| `memorySystem` | string | 是 | 记忆系统标识 | `memory-core` | — | 账号 | 内部 |
| `device` | string | 是 | 归一化设备名 | — | — | 账号 | 内部 |
| `createdAt` / `lastBackupAt` | string | 是 | 本地时间，秒精度 | — | — | 账号 | 内部 |
| `backupType` | string | 是 | 当前固定 `manual` | `manual` | — | 账号 | 内部 |
| `triggerCount` | integer | 是 | ≥1 | 1 | 次 | 账号 | 内部 |
| `files[]` | string[] | 是 | 相对路径，禁止绝对路径与 `..` | — | — | 账号 | 内部 |

#### 7.2.11 Version Contract

| 字段 | 类型 | 必填 | 取值/格式 | 默认 | 单位 | 归属主体 | 可见性 |
|---|---|---|---|---|---|---|---|
| `skill_version` | string | 是 | 语义化版本，如 `1.7.7` | — | — | 技能包 | 用户可见 |
| `required_command_version` | string | 是 | 如 `3.8.9` | — | — | 技能包 | 用户可见 |
| `installer_pinned_version` | string | 是 | 如 `3.8.4` | — | — | 安装脚本 | 内部 |
| `compatible` | boolean | 是 | 已安装版本不低于所需版本 | — | — | guard | 内部 |

`installer_pinned_version` 与 `required_command_version` 不一致时，安装完成后仍可能触发版本不匹配——这不是数据错误，而是分发链路的待修复缺口（D-01）。
