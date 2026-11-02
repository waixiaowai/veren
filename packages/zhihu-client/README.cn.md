# @veren/zhihu-client

Veren 技术栈的知乎数据访问层：规范类型、数据源端口、结构化错误面，以及作为
该端口 v1 实现的官方开放平台客户端。

## 何时使用

当某个功能需要读知乎的账号与内容数据——粉丝数、单篇统计、评论、热榜、适合回答
的问题——而又不想把采集实现焊死在调用方代码里时，使用它。

如果部署根本不碰知乎，或者数据完全来自另一个已有客户端的通道，就不要用它。

## 它提供什么

- **一套词汇表。** 任何响应都被归一成规范类型（`AccountSnapshot`、`ContentRef`、
  `ContentStats`、`CommentItem`、`HotItem`、`QuestionSuggestion`、`QuotaState`）。
  调用方永远看不到平台字段名。
- **一个端口。** `ZhihuDataSource` 是调用方依赖的能力。官方客户端是 v1 实现；
  创作者中心的采集器可以作为 v2 实现接进来，调用方一行都不用改。
- **一处漂移面。** 平台路径住在 `src/official/endpoints.ts`，平台字段名住在
  `src/official/fields.ts`。上游改名只改一个文件。
- **结构化失败。** 每个失败都带稳定 `ZhihuErrorCode`（`ZHIHU_AUTH_REJECTED`、
  `ZHIHU_QUOTA_EXHAUSTED`、`ZHIHU_DAILY_CAP_REACHED`、`ZHIHU_RATE_LIMITED`、
  `ZHIHU_ENDPOINT_DRIFT`、`ZHIHU_NETWORK`、`ZHIHU_INVALID_RESPONSE`），
  绝不靠解析消息文本。

## 用法

```ts
import { OfficialZhihuClient } from '@veren/zhihu-client'

const client = new OfficialZhihuClient({
  accessSecret: process.env.ZHIHU_ACCESS_SECRET ?? '',
  dailyCallLimit: 60,   // 本地日上限——0 表示不限
  minIntervalMs: 3000,  // 两次请求的最小间隔
})

const account = await client.accountStats()
const answers = await client.contents('answer', 20)
const stats = await client.contentStats(answers[0]?.contentId ?? '')
const questions = await client.suggestedQuestions()
```

传输层可注入，测试因此可以把网络换掉：

```ts
const client = new OfficialZhihuClient({
  accessSecret: 'secret',
  fetchImpl: async () => new Response(JSON.stringify({ data: { follower_count: 42 } })),
})
```

## 两道配额闸门

平台免费额度之外还有两道保险：

1. **本地日上限**（`dailyCallLimit`）数着每一次请求，撞到上限就以
   `ZHIHU_DAILY_CAP_REACHED` 停掉这次采集。每个自然日重置。
2. **平台读数**按日缓存。平台报"没有剩余额度"后，后续调用以
   `ZHIHU_QUOTA_EXHAUSTED` 失败，而不是把当天剩下的额度烧光。

请求间隔（`minIntervalMs`）给每次调用留出间距，且所有请求跑在同一条串行链上，
因此并发时这个间距依然成立。

## 错误

```ts
import { ZhihuError, ZhihuErrorCode } from '@veren/zhihu-client'

try {
  await client.accountStats()
} catch (error) {
  if (error instanceof ZhihuError && error.code === ZhihuErrorCode.AuthRejected) {
    // 密钥被拒——重新授权
  }
}
```

## 说明

- Access Secret 是开发者中心创建的平台凭据。本库从不持久化它，存不存是调用方
  的事。
- 这里只做读。发布、评论、关注一律不做：那些动作带着账号风险，而一个只读
  的分析工具没必要承担。
