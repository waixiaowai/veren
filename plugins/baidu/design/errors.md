---
title: 错误码
description: 统一错误码表、上游映射与文案规则。
sidebar:
  order: 6
---
## 5. Error Codes

错误码是四类接口共用的唯一语义来源：接口只引用码，不重复定义含义；同一失败在不同入口必须用同一码。编码规则为 `BDPAN_` 加家族前缀，家族按"错误发生的位置"划分而不是按接口划分，这样同一失败不会因入口不同而换码。

### 5.1 Taxonomy

| 家族 | 编号段 | 含义 | 典型来源 | 默认可重试 |
|---|---|---|---|---|
| 参数与路径 | 1xxx | 请求本身不成立，重发同样失败 | 本地校验、治理面 | 否（确认后重发属新请求） |
| 身份与配额 | 2xxx | 身份、权益、限流、容量约束 | 授权服务、上游网关 | 部分（刷新、退避后可重试） |
| 任务 | 3xxx | 异步任务的状态类结果 | 上游任务接口 | 是（轮询） |
| 分享与转存 | 4xxx | 分享链接、提取码、转存上限 | 转存服务 | 部分 |
| 正文与解析 | 5xxx | 正文检索与文档解析 | 正文服务 | 部分（转换中可重试） |
| 环境与系统 | 9xxx | 网络、上游异常、安装与版本 | 网络栈、分发链路 | 视情况 |

命名只描述"失败的性质"，不描述"哪个界面该怎么提示"；文案规则见 5.5 节。

### 5.2 Global Table

| 码 | 含义 | 触发条件 | 可重试 | 用户可见文案 | 归属模块 |
|---|---|---|---|---|---|
| BDPAN_INVALID_ARG | 参数非法 | 必填缺失、类型不符、互斥开关同时出现、页参数越界 | 否 | 请求的参数不完整或互相冲突，请检查后重试。 | command、bridge、client |
| BDPAN_INVALID_FSID | 文件标识非法 | 非十进制正整数、空串、超出可表示范围 | 否 | 文件标识不正确，请重新选择文件。 | command、bridge |
| BDPAN_INVALID_NAME | 名称非法 | 新名称含路径分隔符、为空、仅含空白 | 否 | 名称不能包含路径分隔符，请换一个名称。 | guard、command |
| BDPAN_PATH_OUT_OF_SCOPE | 路径越界 | 归一后不在 `/apps/bdpan` 内，或含穿越段 | 否 | 只能操作"我的应用数据/bdpan"目录下的内容。 | guard |
| BDPAN_CONFIRM_REQUIRED | 需要确认 | 覆盖、删除、同名下载未取得确认凭证 | 是（确认后重发） | 这个操作会影响已有内容，需要你确认后我再执行。 | skill、command、bridge |
| BDPAN_NOT_FOUND | 对象不存在 | 目录或文件不存在、任务对象已消失 | 否 | 没有找到对应内容，请确认路径或名称。 | command、client、bridge |
| BDPAN_ALREADY_EXISTS | 目标已存在 | 复制、移动、重命名、建目录遇到同名 | 是（改用另存或覆盖策略） | 目标位置已有同名内容，可以另存或覆盖。 | client、command、bridge |
| BDPAN_AUTH_REQUIRED | 未登录 | 无凭据或凭据已被清除 | 是（完成授权后） | 还没有登录，请先完成授权。 | command、bridge、guard |
| BDPAN_TOKEN_EXPIRED | 令牌过期 | 访问令牌到期且刷新失败 | 是（重新授权） | 授权已过期，需要重新登录。 | guard、command |
| BDPAN_TOKEN_INVALID | 令牌无效 | 令牌被吊销、签名不合法、范围不足 | 是（重新授权） | 授权已失效，需要重新登录。 | guard、command |
| BDPAN_FORBIDDEN | 无权限 | 账号无权访问该资源或该接口 | 否 | 当前账号没有访问这个内容的权限。 | guard、client |
| BDPAN_QUOTA_EXCEEDED | 空间不足 | 剩余容量不足以完成写入 | 否 | 网盘空间不足，请清理后再试。 | client、command |
| BDPAN_RATE_LIMITED | 请求过于频繁 | 上游限流 | 是（退避后） | 请求太频繁，稍等片刻再试。 | client、command |
| BDPAN_NOT_SVIP | 需要超级会员 | 正文检索要求超级会员且当前不是 | 否（开通后可重试） | 正文检索需要超级会员，可以先开通再回来。 | skill、command |
| BDPAN_TASK_RUNNING | 任务进行中 | 解析或转存尚未结束 | 是（轮询） | 还在处理中，稍后再查。 | command、skill |
| BDPAN_TASK_NOT_FOUND | 任务不存在 | 任务号失效或不属于当前账号 | 否 | 这个任务已失效，请重新发起。 | command |
| BDPAN_TASK_CONFLICT | 任务冲突 | 已有同类任务进行中，或并发任务超限 | 是（等待约 5 分钟） | 已有同类任务在进行，请等一会儿再试。 | command、client |
| BDPAN_SHARE_PWD_REQUIRED | 需要提取码 | 分享需要提取码但未提供 | 是（补充后） | 这个分享需要提取码，请补充后重试。 | command、skill |
| BDPAN_SHARE_PWD_WRONG | 提取码错误 | 提供了提取码但校验不通过 | 是（更正后） | 提取码不正确，请检查后重试。 | command、skill |
| BDPAN_SHARE_EXPIRED | 分享失效 | 链接被取消、过期或不存在 | 否 | 这个分享链接已失效或不存在。 | command、skill |
| BDPAN_TRANSFER_LIMIT | 转存数量超限 | 单次转存超过账号权益上限 | 否（改为选择性转存） | 这次转存超过了单次数量上限，可以只选其中一部分。 | command、skill |
| BDPAN_FSID_NOT_IN_SHARE | 标识不属于该分享 | 所选文件标识与当前链接不匹配 | 否（重新选择） | 所选文件不在这个分享里，请重新选择。 | command |
| BDPAN_TRANSFER_STATE_UNKNOWN | 任务状态不可查 | 查询被拒或重试后仍无结果 | 是（稍后重查） | 任务已提交，但暂时查不到状态，稍后在网盘确认即可。 | command、skill |
| BDPAN_SEARCH_NOT_READY | 检索结果未就绪 | 正文索引生成中、片段为占位文案 | 是（稍后） | 这份资料的正文索引还没准备好，暂时给不出片段。 | command、skill |
| BDPAN_CONTENT_UNSUPPORTED | 类型不支持读正文 | 图片、音视频、压缩包、目录、无后缀 | 否 | 这个类型暂时不支持读取正文。 | command |
| BDPAN_CONTENT_TOO_LARGE | 内容超出上限 | 单文件超 50 万字、文本超 20 MB、页范围超限 | 否（可缩小范围） | 内容超出单次读取上限，可以按页或分段读取。 | command |
| BDPAN_CONTENT_QUOTA | 当日读取配额用尽 | 字数、页数或文件数到顶 | 否（次日重置） | 今天的读取额度用完了，明天再试。 | command |
| BDPAN_PARSE_CONVERTING | 文件转换中 | 错误文案含"文件转换中" | 是（30–60 秒，上限 5 分钟） | 首次读取需要先做格式转换，正在解析，请稍候。 | command、skill |
| BDPAN_PARSE_INVALID_FILE | 文件无法解析 | 错误文案含"文件无效"，或文件损坏 | 否 | 这个文件无法解析，可能是文件损坏或格式异常。 | command、skill |
| BDPAN_PARSE_TIMEOUT | 解析超时 | 任务执行超时 | 是（稍后） | 解析超时了，建议稍后重试。 | command |
| BDPAN_PARSE_INTERNAL | 解析服务内部错误 | 上游内部失败 | 是（稍后） | 解析服务暂时不可用，稍后再试。 | command |
| BDPAN_NETWORK | 网络失败 | 连接中断、超时、DNS 失败 | 是（退避） | 网络连接不稳定，正在重试。 | client、command |
| BDPAN_UPSTREAM | 上游失败 | 上游返回未归类错误（含内部错误、目标创建失败） | 视情况 | 服务暂时没有返回可用结果，请稍后再试。 | 全部 |
| BDPAN_INTEGRITY_FAILED | 完整性校验失败 | 安装包或更新包哈希不匹配 | 否（重新下载） | 安装包校验没有通过，已停止安装。 | delivery |
| BDPAN_VERSION_MISMATCH | 版本不匹配 | 技能要求版本高于已安装命令 | 是（升级后） | 当前版本偏低，需要先升级再继续。 | delivery、skill |
| BDPAN_OUTPUT_UNCERTAIN | 结果不确定 | 写入后响应缺失，无法确认是否落盘 | 是（查询确认） | 这次操作的结果还不确定，我先确认一下再告诉你。 | client、command |
| BDPAN_UNKNOWN | 未知错误 | 未归类的异常 | 视情况 | 遇到了未预期的问题，请稍后重试。 | 全部 |

### 5.3 Upstream Mapping

上游存在四类错误形态，命令层与库层必须先归一再看错误号；映射表是唯一依据，禁止在各接口内另写判断。

| 上游错误号 | 统一码 | 备注 |
|---|---|---|
| -6 | BDPAN_FORBIDDEN | 身份验证失败，也可能表示授权范围不足 |
| -7 | BDPAN_INVALID_NAME | 文件名不合法；文档中"路径不存在"的旧描述作废 |
| -8 | BDPAN_ALREADY_EXISTS | 同名冲突 |
| -9 | BDPAN_NOT_FOUND | 路径不存在 |
| -10 / 31190 | BDPAN_QUOTA_EXCEEDED | 空间不足 |
| 2 | BDPAN_INVALID_ARG | 参数错误 |
| 12 | BDPAN_UPSTREAM | 移动类内部错误；先排查源与目标是否相同 |
| 111 | BDPAN_TASK_RUNNING | 异步任务进行中 |
| 20016 | BDPAN_TOKEN_EXPIRED | 令牌过期 |
| 20017 / 31045 | BDPAN_TOKEN_INVALID | 令牌无效或校验失败 |
| 31023 | BDPAN_FORBIDDEN | 命中黑名单 |
| 31034 | BDPAN_RATE_LIMITED | 频率超限 |
| 13003 | BDPAN_SHARE_PWD_REQUIRED / BDPAN_SHARE_PWD_WRONG | 未提供提取码与提取码错误共用上游码，按是否提供过区分 |
| 13004 | BDPAN_SHARE_EXPIRED | 分享已失效 |
| 13041 | BDPAN_FSID_NOT_IN_SHARE | 标识不属于当前分享 |
| 13061 | BDPAN_INVALID_FSID | 标识错误或已不存在 |
| 13070 | BDPAN_TRANSFER_STATE_UNKNOWN | 重试后仍查不到任务 |
| 13071 | BDPAN_TASK_CONFLICT | 已有其他转存任务 |
| 13072 / 13073 | BDPAN_TRANSFER_LIMIT | 达单次转存上限 |
| 20013 | BDPAN_UPSTREAM | 目标目录创建失败 |
| 21061 / 21062 | BDPAN_NOT_FOUND / BDPAN_CONTENT_UNSUPPORTED | 文本预览：文件不存在 / 校验失败 |
| 21064 | BDPAN_CONTENT_TOO_LARGE | 文本超过 20 MB |
| 40101 | BDPAN_INVALID_ARG | 解析入参非法 |
| 40102 | BDPAN_TASK_NOT_FOUND | 任务不存在 |
| 40103 | BDPAN_NOT_FOUND | 文件不存在或无权访问 |
| 40104 | BDPAN_CONTENT_UNSUPPORTED | 类型不支持 |
| 40105 / 40106 | BDPAN_CONTENT_TOO_LARGE | 文件过大 / 单次内容超限 |
| 40107 | BDPAN_TASK_CONFLICT | 并发任务超限 |
| 40108 | BDPAN_CONTENT_QUOTA | 当日配额超限 |
| 50101 | BDPAN_PARSE_CONVERTING 或 BDPAN_PARSE_INVALID_FILE | 必须看文案：含"文件转换中"取前者，含"文件无效"取后者 |
| 50102 | BDPAN_PARSE_TIMEOUT | 任务超时 |
| 50103 | BDPAN_PARSE_INTERNAL | 服务内部错误 |
| 无错误号但 HTTP 非 2xx | BDPAN_UPSTREAM | 保留状态码与截断后的响应摘要 |
| HTTP 200 但 JSON 解析失败 | BDPAN_UPSTREAM | 不重试，保留响应摘要 |

### 5.4 Retry

| 场景 | 最大次数 | 间隔 | 终止条件 | 备注 |
|---|---|---|---|---|
| 网络抖动、超时、5xx、限流 | 3 | 1 秒、2 秒、4 秒（指数） | 次数用尽或上下文取消 | 上传按分片重试，不整文件重传 |
| 令牌过期 | 1 | 立即 | 刷新失败即终止 | 刷新成功后重放原请求 |
| 创建文件后响应缺失 | 1 次查询 | 立即查询 | 查询到即采用，查询不到按某失败码返回 | 结果不确定时禁止盲目重发 |
| 正文解析转换中 | 建议 5 次 | 30–60 秒 | 总时长 300 秒 | 只重试失败项，不重发整批 |
| 转存任务轮询 | 未固定 | 30 秒 | 总时长 300 秒 | 查询被拒不等于失败，保留任务号 |
| 解析任务轮询 | 未固定 | 30–60 秒 | 总时长 300 秒 | `running` 时退出码为 1，属正常中间态 |

一律不重试：参数非法、路径越界、未登录且未完成授权、对象不存在、分享失效、令牌无效、配额超限、完整性校验失败、版本不匹配。

### 5.5 Copy Rules

文案三段式，缺一不可：说明发生了什么（事实）、为什么（原因，未知时说"暂时无法确认"）、下一步做什么（可执行动作或明确的等待）。禁止只写"失败""出错了""请重试"。

| 规则 | 反例 | 正例 |
|---|---|---|
| 不把中间态说成失败 | "转存失败" | "转存任务已提交，结果稍后确认" |
| 不把失败说成成功 | "已保存"（实际已提交） | "已提交转存，完成后我会告诉你保存路径" |
| 技术错误保留码但翻译成人话 | "errno=13003" | "这个分享需要提取码，请补充后重试（错误码 13003）" |
| 越权不透露他人信息 | "目录 /other 无权限" | "只能操作『我的应用数据/bdpan』下的内容" |
| 不确定就说不确定 | "文件里没有提到" | "正文索引还没准备好，暂时无法判断是否提到" |
| 提供可执行动作 | "空间不足" | "空间不足，剩余 0 B，请清理后再试" |

中英双语要求：面向用户的文案必须同时提供中文与英文版本，术语与第 15 章一致；英文文案不直译中文语序，保持"事实—原因—下一步"结构。
