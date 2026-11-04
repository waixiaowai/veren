---
title: 服务端接口设计
description: 命令、工具、库与上游四层接口清单。
sidebar:
  order: 4
---
## 3. API Design

本系统没有自建服务端，接口分为四类：命令接口（用户与 Agent 调用的子命令）、工具接口（协议宿主调用的工具目录）、库接口（开发者调用的方法）、上游接口（能力最终落到外部服务的形式）。四类接口共用同一套错误码（第 5 章）、同一套状态语义（第 6 章）与同一套字段定义（第 7 章）；本章只定义各接口的路径、参数、返回与失败，不重复解释错误码语义。

### 3.1 Interface Inventory

| 层 | 标识前缀 | 调用方 | 传输 | 凭据位置 | 数量 |
|---|---|---|---|---|---|
| 命令接口 | `CLI-` | 用户、Agent 宿主、脚本 | 进程调用，标准输出/标准错误 | 本机凭据库（隐式） | 25 |
| 工具接口 | `MCP-` | 协议宿主 | 工具调用（远端或本地进程） | 连接参数或环境变量 | 18 |
| 库接口 | `SDK-` | 开发者应用 | 进程内方法调用 | 初始化参数 | 14 |
| 上游接口 | `UP-` | 命令层、库层（经治理面） | HTTPS | 请求头或查询参数 | 13 |

命名规则：前缀加动作，动作用大写下划线；同一能力在三层的标识保持词根一致（如上传在 `CLI-UPLOAD`、`MCP-UPLOAD-LOCAL`、`SDK-UPLOAD`、`UP-PRECREATE` 中可对应）。接口标识一经发布不再改动；确需改名时在 17.3 节记录影响范围。

### 3.2 Unified Envelope

【拟议】P-01：现有命令输出存在三种形态（统一信封、裸对象、顶层数组/列表），调用方必须逐命令记忆字段位置，这是"链接漏展示"与"误判成功"的结构性原因。收敛目标如下，迁移期以"新增字段不改旧字段"的方式兼容。

```json
{
  "code": 0,
  "data": { },
  "error": "",
  "meta": {
    "command": "upload",
    "duration_ms": 1832,
    "agent": { "name": "claude-code", "session_id": "1784035443-a1b2c3" },
    "links": [{ "markdown": "[点击查看](https://…)", "target": "file" }]
  }
}
```

约束：`code` 只取 0 或 1；失败时 `data` 为 `null` 且 `error` 非空；`meta.links` 为归一化后的链接集合，每项与 `data` 中的对象按顺序对应；分页信息统一放 `meta.page = { page, page_size, total?, has_more }`；部分成功统一为 `code=1` 且 `data.items[]` 完整、失败项带 `error`。迁移完成前，各接口的"结果位置"列仍以现状为准。

### 3.3 CLI Interfaces

所有命令均为同一可执行文件的子命令；除 `login`、`logout`、`whoami`、`vip`、`init`、`version` 外，其余命令都要求有效凭据。公共开关：`--json`（机器可读）、`--config-path`、`--no-check-update`、`--agentname`、`--session-input`、`--session-id`、`--uid`、`--traceid`。

读表约定：每个接口的"路径"即子命令（含子命令组，如 `transfer list`），"方法"为一次性进程调用，"协议"为命令行参数与标准输出/标准错误的约定；身份由本机凭据库隐式提供，角色与资源级权限统一引用 4.2 节矩阵，不在本表重复判定。

| 标识 | 子命令 | 请求要点 | 结果位置 | 成功语义 | 关键失败码 |
|---|---|---|---|---|---|
| CLI-LOGIN | `login` | 取授权地址；回填授权码（标准输入）；免责声明确认 | 文本 / 授权地址 | 凭据写入本机库 | BDPAN_AUTH_REQUIRED、BDPAN_TOKEN_INVALID |
| CLI-LOGOUT | `logout` | 无参数 | 文本 | 本机凭据清除 | BDPAN_INVALID_ARG |
| CLI-WHOAMI | `whoami` | `--json` 可含会员字段 | 统一信封 | 返回登录状态与到期时间 | — |
| CLI-VIP | `vip` | 无参数 | 统一信封 | 返回两条收银台链接 | — |
| CLI-QUOTA | `quota` | 无参数 | 统一信封 | 返回容量快照 | BDPAN_AUTH_REQUIRED、BDPAN_UPSTREAM |
| CLI-UPLOAD | `upload` | 本地路径、远端路径、可选 `--overwrite` | 统一信封 | 返回动作类型与落点 | BDPAN_CONFIRM_REQUIRED、BDPAN_PATH_OUT_OF_SCOPE、BDPAN_ALREADY_EXISTS、BDPAN_QUOTA_EXCEEDED |
| CLI-DOWNLOAD | `download` | 远端路径或分享链接、本地路径、`-p`、`-t` | 统一信封 | 返回本地落点（分享模式另含保存路径） | BDPAN_NOT_FOUND、BDPAN_SHARE_EXPIRED、BDPAN_TRANSFER_LIMIT |
| CLI-TRANSFER | `transfer` | 分享链接、`-p`、`-d` | 裸对象 | 完成或已提交 | BDPAN_SHARE_PWD_REQUIRED、BDPAN_SHARE_EXPIRED、BDPAN_TRANSFER_BUSY、BDPAN_TRANSFER_LIMIT |
| CLI-TRANSFER-LIST | `transfer list` | 分享链接、`--source-dir`、`--page`、`--page-size`、`-p` | 裸对象 | 分享目录条目 | BDPAN_NOT_FOUND、BDPAN_SHARE_EXPIRED |
| CLI-TRANSFER-SELECT | `transfer select` | 分享链接、`--fsid`（逗号分隔）、`-p`、`-d` | 裸对象 | `status=submitted` | BDPAN_INVALID_FSID、BDPAN_FSID_NOT_IN_SHARE、BDPAN_TRANSFER_LIMIT |
| CLI-LS | `ls` | 路径、`--order`、`--desc`、`--folder` | 顶层数组 | 目录条目 | BDPAN_NOT_FOUND、BDPAN_PATH_OUT_OF_SCOPE |
| CLI-SHARE | `share` | 一个或多个路径、`--period` | 裸对象 | 链接、提取码、有效期 | BDPAN_NOT_FOUND、BDPAN_UPSTREAM |
| CLI-SEARCH | `search` | 关键词、`--category`、`--page`、`--page-size`、`--no-dir`、`--dir-only` | 顶层 `items[]` | 检索条目 | BDPAN_INVALID_ARG、BDPAN_UPSTREAM |
| CLI-SEARCH-CONTENT | `search-content` | 查询词、`--dir` 或 `--dir-fsid`、`--file-types`、`--page-size` | 统一信封（`data.hits[]`） | 命中片段与链接 | BDPAN_NOT_SVIP、BDPAN_CONTENT_UNSUPPORTED、BDPAN_SEARCH_NOT_READY |
| CLI-GET-CONTENT | `get-content` | 1 至 5 个文件标识、`--page-start`、`--page-end` | 统一信封（`data[]`） | 正文或任务号 | BDPAN_CONTENT_UNSUPPORTED、BDPAN_CONTENT_TOO_LARGE、BDPAN_TASK_RUNNING |
| CLI-GET-CONTENT-RESULT | `get-content-result` | 任务号 | 统一信封（`data{}`） | 任务状态与正文 | BDPAN_TASK_NOT_FOUND、BDPAN_PARSE_CONVERTING、BDPAN_PARSE_INVALID_FILE |
| CLI-MV | `mv` | 源路径、目标目录 | 裸对象 | 移动完成 | BDPAN_NOT_FOUND、BDPAN_ALREADY_EXISTS、BDPAN_UPSTREAM |
| CLI-CP | `cp` | 源路径、目标目录 | 裸对象 | 复制完成 | 同上 |
| CLI-RENAME | `rename` | 源路径、新名称 | 裸对象 | 重命名完成 | BDPAN_ALREADY_EXISTS、BDPAN_INVALID_ARG |
| CLI-MKDIR | `mkdir` | 路径 | 裸对象 | 目录创建 | BDPAN_ALREADY_EXISTS、BDPAN_PATH_OUT_OF_SCOPE |
| CLI-RM | `rm` | 一个或多个路径、`--force` | 统一信封 | 删除数量 | BDPAN_CONFIRM_REQUIRED、BDPAN_NOT_FOUND |
| CLI-HELP | `--help` | 无参数 | 文本 | 用法与参数说明 | — |
| CLI-INIT | `init` | 无参数 | 文本 | 安装路径与建议 | — |
| CLI-VERSION | `version` | 可选 `--check` | 文本 | 版本号与更新提示 | — |
| CLI-UPDATE | `update` | 由脚本承担 | 文本 | 技能包更新结果 | BDPAN_INTEGRITY_FAILED、BDPAN_VERSION_MISMATCH |
| CLI-UNINSTALL | `uninstall` | `--yes` | 文本 | 卸载结果 | — |

#### 3.3.1 Upload

用途：把本地文件或目录上传到授权根内的目标路径。所属模块 command；传输为进程调用；身份由本机凭据库提供，权限要求"授权根内写"。

请求：位置参数 `local`（必填，本地已存在的普通文件或目录）、`remote`（必填，单文件时为文件名，目录上传时以 `/` 结尾）；开关 `--overwrite`（仅单文件生效，默认关闭）、`--json`；上下文 `--agentname`、`--session-input`、`--session-id`、`--uid`、`--traceid`。

响应（`--json`，统一信封）：`data.action` 取 `created`/`renamed`/`overwritten`/`unchanged`/`unknown`；`data.saved_path` 为面向用户的实际落点；`data.requested_path` 为请求目标；`data.conflict_detected` 表示预检发现同名；`data.verification=metadata` 且 `data.content_verified=false`；`data.fsid` 为字符串；`data.return_markdown` 为预渲染链接。

错误语义：目录上传带 `--overwrite` 一律参数错误；覆盖未经会话确认返回 BDPAN_CONFIRM_REQUIRED；空间不足返回 BDPAN_QUOTA_EXCEEDED 且不重试；结果不确定时 `action=unknown`、非零退出，禁止自动重传。

#### 3.3.2 Download

请求：`remote`（远端路径或分享链接）、`local`（本地保存路径），`-p/--pwd`（提取码）、`-t`（转存目录）、`--json`。分享模式语义为"先转存后下载"，转存目录缺省按日期建在授权根下。

响应：`data.local`、`data.remote`、`data.fsid`、`data.return_markdown`；分享模式另含 `data.share`、`data.count`、`data.saved_path`。

错误语义：本地目标已存在时需用户确认（BDPAN_CONFIRM_REQUIRED）；分享链接无码时不得预先索要提取码；转存后下载失败保留已转存结果并分别报告。

#### 3.3.3 Transfer and Selection

`CLI-TRANSFER` 请求：`分享链接`、`-p`、`-d`、`--json`。响应为裸对象：完成时含 `saved_path`、`count`、`files[]`（每项含 `saved_path`、`fsid`、`return_markdown`）；已提交时含 `status=submitted` 与 `task_id`。

`CLI-TRANSFER-LIST` 请求：`分享链接`、`--source-dir`（空表示第一层）、`--page`（≥1，默认 1）、`--page-size`（1–100，默认 100）、`-p`、`--json`。响应：`count`、`has_more`、`dir`、`list[]`（含 `path`、`name`、`is_dir`、`fsid` 字符串）。

`CLI-TRANSFER-SELECT` 请求：`分享链接`、`--fsid`（必填，逗号分隔或重复传入）、`-p`、`-d`（不存在则自动创建）、`--json`。响应：`status=submitted`、`task_id`。

错误语义：`13003` 需区分"未提供提取码"与"提取码错误"；`13004` 链接失效不重试；`13070` 查询不到任务保留任务号；`13071` 有其他任务进行中，等待后重试；`13072/13073` 达数量上限，改为选择性转存；`13061/13041` 所选标识有误；`20013` 目标目录创建失败。

#### 3.3.4 Listing and Search

`CLI-LS` 请求：`path`（缺省为授权根）、`--order`（`name`/`time`/`size`）、`--desc`、`--folder`、`--json`。响应为顶层数组，每项含 `fsid`（字符串）、`path`、`server_filename`、`size`、`isdir`、`md5`、`server_mtime`、`server_ctime`、`return_markdown`/`return_url`、`return_hint`、`client_return_target_type`。

`CLI-SEARCH` 请求：`关键词`、`--category`（0–7，默认 0）、`--page`（默认 1）、`--page-size`（默认 5，上限 50）、`--no-dir` 与 `--dir-only`（互斥）、`--json`。响应：`total`、`page`、`page_size`、`items[]`。

错误语义：`--no-dir` 与 `--dir-only` 同时出现为参数错误；页码越界返回空列表而非错误；链接缺失时不得自行拼接。

#### 3.3.5 Content Search

用途：在授权根内检索文档正文并返回片段。身份要求超级会员（服务端最终校验）；权限为"授权根内读"。

请求：`query`（必填）、`--dir`（相对授权根或授权根内绝对路径）与 `--dir-fsid`（互斥）、`--file-types`（`pdf,docx,txt,md,pptx,xlsx` 的子集）、`--page-size`（1–50，默认 10）、`--json`、`--no-check-update`。

响应：统一信封，`data` 含 `status`（`succeeded`/`partial`/`failed`/`unsupported`）、`hits[]`（`fsid`、`file_name`、`path`、`snippet`、`file_url`、`file_url_target`、`source_ref_id`）、`source_refs[]`、`total`、`returned_count`、`total_scope`（固定 `returned_candidates`）、`index_status`（当前 `unknown`）、`capabilities`（定位、续页、索引状态三项均为 false）、`show_msg`、`retryable`。

错误语义：非超级会员返回 BDPAN_NOT_SVIP 并给会员入口；配额或权限失败展示 `data.show_msg`（缺失时用 `error`）；零结果不等于"资料不存在"；`snippet` 为占位文案时不得当作正文。

#### 3.3.6 Content Reading

请求（`CLI-GET-CONTENT`）：1 至 5 个 `fsid`；`--page-start`、`--page-end`（仅单文件的 Word/PDF/PPT 支持，Excel 与文本类不支持，`start ≤ end`）；`--json`。响应：`data` 恒为数组，顺序与输入一致；文本类项含 `content`；文档类项只含 `task_id`，同批共用一个任务号。

请求（`CLI-GET-CONTENT-RESULT`）：`taskid`；`--json`。响应：`data` 为对象，含 `task_id`、`status`（`running`/`succeeded`/`partial`/`failed`）、`files[]`（`content` 或 `url`、`page_start`、`page_end`、`page_num`、`char_count`、`truncated`、`error`、`return_markdown`）。

错误语义：`running` 时退出码为 1 但不是失败；单项失败不影响其他项，整条命令非零退出；`50101` 必须按文案细分（"文件转换中"可重试，"文件无效"不可）；`40108` 为当日配额超限，次日重置；正文超 2 万字时 `content` 为空、`url` 为 2 小时有效的签名地址。

#### 3.3.7 Removal and File Management

`CLI-RM` 请求：一个或多个路径、`--force`（跳过交互提示，不替代用户确认）、`--json`。响应：`data` 含成功数量；仅报告实际删除数。

`CLI-MV`/`CLI-CP` 请求：源路径、目标目录；响应为裸对象（`status=ok` 与回端链接）。`CLI-RENAME` 请求：源路径、新名称（不得含分隔符）。`CLI-MKDIR` 请求：路径（可多级）。

错误语义：`mv` 返回内部服务错误时先检查源与目标是否相同、是否把目录移动到自身；目标已存在时不覆盖；失败不得表述为已删除或已移动。

### 3.4 Tool Interfaces

工具接口的公共约定：参数名使用下划线命名；路径必须为绝对路径；文件标识一律字符串；结果为文本块数组；失败以 `isError=true` 加错误码表达。远端形态不提供本地上传工具，本地形态额外提供 `MCP-UPLOAD-LOCAL`。读表约定：路径即工具名，方法为一次工具调用，协议为宿主与网关之间的请求/响应；身份随连接注入，权限判定引用 4.2 节矩阵。

| 标识 | 工具名 | 请求参数 | 返回要点 | 风险级 |
|---|---|---|---|---|
| MCP-FILE-LIST | `file_list` | `dir`、`page` | 条目数组：标识、路径、名称、大小、类型、摘要 | 只读 |
| MCP-FILE-DOC-LIST | `file_doc_list` | `dir`、`page` | 同上，限定文档 | 只读 |
| MCP-FILE-IMAGE-LIST | `file_image_list` | `dir`、`page` | 同上，限定图片 | 只读 |
| MCP-FILE-VIDEO-LIST | `file_video_list` | `dir`、`page` | 同上，限定视频 | 只读 |
| MCP-FILE-META | `file_meta` | `fsids`（≤10） | 条目数组 | 只读 |
| MCP-MKDIR | `make_dir` | `path`、`rtype` | 标识、路径、是否目录 | 写入 |
| MCP-COPY | `file_copy` | `async`、`ondup`、`filelist[]` | 任务号或结果 | 写入 |
| MCP-DELETE | `file_del` | `async`、`ondup`、`filelist[]` | 任务号或结果 | 危险 |
| MCP-MOVE | `file_move` | `async`、`ondup`、`filelist[]` | 任务号或结果 | 写入 |
| MCP-RENAME | `file_rename` | `async`、`ondup`、`filelist[]` | 任务号或结果 | 写入 |
| MCP-KEYWORD-SEARCH | `file_keyword_search` | `dir`、`key`、`page`、`num` | 条目数组 | 只读 |
| MCP-SEMANTIC-SEARCH | `file_semantics_search` | `dir`、`query` | 条目数组（含摘要与缩略图） | 只读 |
| MCP-SHARE-CREATE | `file_sharelink_set` | `fsid_list`、`period`、`pwd` | 链接、有效期、提取码、短链 | 写入 |
| MCP-USER-INFO | `user_info` | 无 | 头像、会员类型、账号标识 | 只读 |
| MCP-QUOTA | `get_quota` | 无 | 总量、已用、免费容量、到期提示 | 只读 |
| MCP-UPLOAD-URL | `file_upload_by_url` | `url`、`dir`、`filename` | 标识、路径、大小 | 写入 |
| MCP-UPLOAD-TEXT | 待定（文本上传） | `content`（≤2 万字）、`dir`、`filename` | 标识、路径、大小 | 写入 |
| MCP-UPLOAD-LOCAL | `upload_file` | `local_file_path`、`remote_path` | 标识、路径、大小 | 写入 |

#### 3.4.1 File List Tool

请求：`dir`（字符串，必填，绝对路径，含中文需编码）、`page`（整数，可选，从 1 开始；缺省时不分页返回全部）。响应文本：条目数组的 JSON 文本，字段为 `fsid`、`path`、`md5`、`category`、`size`、`filename`、`content`（分段内容，未生成为空）、`thumbnail`、`abstract`。

错误语义：`dir` 不以 `/` 开头为参数错误；目录不存在返回 BDPAN_NOT_FOUND；分页越界返回空数组。

#### 3.4.2 Share Tool

请求：`fsid_list`（必填，JSON 字符串数组，元素为字符串）、`period`（整数天，默认 7）、`pwd`（4 位数字加小写字母，默认 1234）。响应：`link`、`period`、`pwd`、`short_url`。错误语义：数组格式非法（例如传成数值数组或非 JSON）为参数错误；无权限分享返回 BDPAN_FORBIDDEN。

### 3.5 Library Contracts

库接口以方法签名定义，全部接受可取消上下文；失败以统一失败对象抛出（见 2.1.2）。权限与命令层一致：写操作必须落在授权根内，路径判断由 guard 提供。

| 标识 | 方法 | 请求 | 返回 | 失败码 |
|---|---|---|---|---|
| SDK-AUTH-CODE | `auth.codeToToken` | 应用标识、密钥、授权码 | 令牌三元组 | BDPAN_TOKEN_INVALID |
| SDK-AUTH-DEVICE | `auth.deviceCode` / `auth.deviceToken` | 应用标识、密钥、设备码 | 设备码或令牌 | BDPAN_AUTH_REQUIRED |
| SDK-AUTH-REFRESH | `auth.refresh` | 应用标识、密钥、刷新令牌 | 新令牌 | BDPAN_TOKEN_EXPIRED |
| SDK-PROFILE | `profile` | 无 | 账号资料 | BDPAN_AUTH_REQUIRED |
| SDK-QUOTA | `quota` | 无 | 容量快照 | BDPAN_UPSTREAM |
| SDK-LIST | `listDir` | 目录、排序、偏移、数量、仅目录 | 条目数组 | BDPAN_NOT_FOUND |
| SDK-SEARCH | `search` | 查询词、目录、类型、上限 | 条目数组 | BDPAN_INVALID_ARG |
| SDK-UPLOAD | `upload` | 见 2.1.2 | 上传回执 | BDPAN_ALREADY_EXISTS、BDPAN_QUOTA_EXCEEDED |
| SDK-DOWNLOAD | `download` | 文件标识、本地路径 | 下载回执 | BDPAN_NOT_FOUND |
| SDK-COPY / SDK-MOVE / SDK-RENAME | 同名方法 | 源、目标目录、新名 | 空 | BDPAN_ALREADY_EXISTS |
| SDK-DELETE | `remove` | 路径数组 | 空 | BDPAN_NOT_FOUND |
| SDK-MKDIR | `mkdir` | 路径 | 空 | BDPAN_ALREADY_EXISTS |

### 3.6 Upstream Mapping

上游接口不由本系统定义，但命令层与库层需要知道"哪个能力落在哪个上游接口"，以便错误映射与限流判断。下表只列本方案实际使用的能力。

| 标识 | 上游方法 | 上游路径 | 主要参数 | 被谁使用 |
|---|---|---|---|---|
| UP-AUTH-CODE | 授权码换令牌 | 授权服务令牌端点 | 应用标识、密钥、授权码 | CLI-LOGIN、SDK-AUTH-CODE |
| UP-AUTH-DEVICE | 设备码与设备令牌 | 授权服务设备端点 | 应用标识、设备码 | SDK-AUTH-DEVICE |
| UP-AUTH-REFRESH | 刷新令牌 | 授权服务令牌端点 | 刷新令牌 | SDK-AUTH-REFRESH、guard |
| UP-UINFO | 用户信息 | 网盘用户接口 | 会员版本（可选） | CLI-WHOAMI、MCP-USER-INFO、SDK-PROFILE |
| UP-QUOTA | 容量 | 网盘容量接口 | 无 | CLI-QUOTA、MCP-QUOTA、SDK-QUOTA |
| UP-LIST | 文件列表 | 网盘文件接口 | 目录、排序、偏移、数量、是否仅目录 | CLI-LS、MCP-FILE-LIST、SDK-LIST |
| UP-UNISEARCH | 语义检索 | 网盘检索接口 | 查询词、目录范围、类型、数量 | SDK-SEARCH、CLI-SEARCH |
| UP-PRECREATE | 预创建 | 网盘文件接口 | 路径、大小、分片摘要、冲突策略 | SDK-UPLOAD、MCP-UPLOAD-LOCAL |
| UP-SLICE | 分片上传 | 分片上传接口 | 路径、上传标识、序号、分片 | SDK-UPLOAD、MCP-UPLOAD-LOCAL |
| UP-CREATE | 创建文件 | 网盘文件接口 | 路径、大小、上传标识、分片摘要 | SDK-UPLOAD、MCP-UPLOAD-LOCAL |
| UP-META | 取直链 | 网盘下载接口 | 文件标识数组 | SDK-DOWNLOAD |
| UP-DOWNLOAD | 流式下载 | 直链地址 | 直链 | SDK-DOWNLOAD |
| UP-FM | 文件管理 | 网盘文件管理接口 | 操作类型、异步模式、冲突策略、文件清单 | CLI-MV/CP/RENAME/MKDIR/RM、MCP-COPY/MOVE/RENAME/MKDIR/DELETE、SDK-* |

上游错误形态有四类（错误号对象、旧版错误码对象、标准错误对象、检索专用错误号对象），统一在库层归一，命令层与工具层只消费统一码。新增上游能力时，必须先在上表登记标识与使用方，再实现接口，避免"能力已上线、契约无归属"。
