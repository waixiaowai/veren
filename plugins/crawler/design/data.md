---
title: 数据字典
description: 关键实体的字段定义、类型、必填性与脱敏约束。
sidebar:
  order: 7
lastUpdated: 2026-11-04
---

数据字典集中列出落地介质的关键实体字段。各模块契约引用本字典，不重复定义；通用字段全表一致。

## 1. Common Fields

所有内容表与评论表共享的通用字段：

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 所属主体与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| creator_hash | string | 是 | 64 位哈希的截断十六进制（16 位） | — | — | 数据来源主体；仅本机使用者可见 |
| nickname | string | 是 | 遮蔽昵称（首尾各一字，中间星号） | — | — | 同上 |
| source_keyword | string \| null | 否 | 采集来源关键词 | null | — | 采集上下文 |
| add_ts | integer | 是 | Unix 毫秒时间戳 | 写入时刻 | 毫秒 | 系统 |
| last_modify_ts | integer | 是 | Unix 毫秒时间戳 | 写入时刻 | 毫秒 | 系统 |

## 2. Content Entities

内容实体按平台一表，字段结构统一（平台无关字段缺失时存 null）：

| 字段 | 类型 | 必填 | 取值或格式 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 | 平台业务主键 | note_id / aweme_id / video_id / content_id 等 |
| title | string \| null | 否 | 文本 | 标题，可为空 |
| desc | string \| null | 否 | 长文本 | 正文描述 |
| url | string | 是 | 完整访问地址 | 平台适用时携带访问令牌 |
| publish_time | string \| null | 否 | 平台时间格式或日期 | 发布时间 |
| liked_count / comment_count / collected_count / share_count | integer \| null | 否 | 非负整数 | 互动计数，增量更新目标 |
| image_list | string | 否 | 逗号分隔地址串 | 图片地址列表 |
| video_url | string \| null | 否 | 地址 | 视频地址 |
| tag_list | string | 否 | 逗号分隔标签串 | 标签列表 |
| type | string \| null | 否 | 平台内容类型 | 知乎为 article/answer/zvideo 三枚举 |
| tieba_id / tieba_name / tieba_link | string \| null | 否 | 贴吧标识 | 仅贴吧表 |
| xsec_token | string \| null | 否 | 访问令牌 | 仅小红书表，详情与评论复用 |
| total_replay_num / page | integer \| null | 否 | 非负整数 | 仅贴吧表 |

## 3. Comment Entities

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 评论业务主键 |
| content_id | string | 是 | 归属内容主键 |
| parent_comment_id | string \| null | 否 | 二级评论指向一级评论 id |
| content | string | 是 | 评论正文 |
| like_count | integer \| null | 否 | 点赞数 |
| sub_comment_count | integer \| null | 否 | 子评论数 |
| pictures | string \| null | 否 | 评论图片地址串 |
| publish_time | string \| null | 否 | 发布时间 |

## 4. Creator Handling

创作者档案在教学版中不落库：`store_creator` 为空实现，全部数据表已移除创作者档案字段。创作者身份仅以 `creator_hash` 与遮蔽昵称随内容、评论出现。B 站 UP 主信息表保留展示性字段（昵称、签名等以脱敏形态），粉丝与关注计数在教学版中禁用采集。

## 5. Non-DB Artifacts

| 产物 | 位置 | 命名规则 | 说明 |
| --- | --- | --- | --- |
| 数据文件 | 数据根/平台/{csv,json,jsonl}/ | 采集模式_实体类型_日期.扩展名 | csv 带表头，jsonl 为词云数据源 |
| Excel 文件 | 数据根/平台/ | 平台_采集模式_时间戳.xlsx | 工作表：Contents、Comments（B 站另有 Contacts、Dynamics） |
| 媒体文件 | 数据根/平台/media/内容ID/ | 清洗后文件名 + 白名单扩展名 | 断点续传临时文件 .part 完成后移除 |
| 词云图 | 数据根/平台/words/ | 采集模式_comments_日期 前缀 | 依据 jsonl/json 评论生成 |
| 登录档案 | 浏览器数据目录/平台_user_data_dir/ | 平台隔离 | 凭证专用，不属于数据产物 |
