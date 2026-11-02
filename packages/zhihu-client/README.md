# @veren/zhihu-client

Zhihu data access for the Veren stack: the canonical types, the data-source
port every collector implements, the structured error face, and the official
open-platform client that is the port's v1 implementation.

## When to use

Use it when a feature must read Zhihu account and content data — follower
counts, per-content statistics, comments, the hot list, answerable questions —
without hard-coding a collector into the calling code.

Skip it when the deployment never talks to Zhihu, or when the data comes from
an entirely different channel that already has its own client.

## What it gives you

- **One vocabulary.** Every response is normalized into the canonical types
  (`AccountSnapshot`, `ContentRef`, `ContentStats`, `CommentItem`, `HotItem`,
  `QuestionSuggestion`, `QuotaState`). Callers never see a platform field
  name.
- **One port.** `ZhihuDataSource` is the capability callers depend on. The
  official client is the v1 implementation; a creator-center collector can
  become the v2 implementation without touching a caller.
- **One drift surface.** Platform paths live in `src/official/endpoints.ts`
  and platform field names live in `src/official/fields.ts`. An upstream
  rename is a one-file edit.
- **Structured failures.** Every failure carries a stable `ZhihuErrorCode`
  (`ZHIHU_AUTH_REJECTED`, `ZHIHU_QUOTA_EXHAUSTED`, `ZHIHU_DAILY_CAP_REACHED`,
  `ZHIHU_RATE_LIMITED`, `ZHIHU_ENDPOINT_DRIFT`, `ZHIHU_NETWORK`,
  `ZHIHU_INVALID_RESPONSE`), never a message to parse.

## Usage

```ts
import { OfficialZhihuClient } from '@veren/zhihu-client'

const client = new OfficialZhihuClient({
  accessSecret: process.env.ZHIHU_ACCESS_SECRET ?? '',
  dailyCallLimit: 60,   // the local daily cap — 0 means unlimited
  minIntervalMs: 3000,  // the minimum gap between two requests
})

const account = await client.accountStats()
const answers = await client.contents('answer', 20)
const stats = await client.contentStats(answers[0]?.contentId ?? '')
const questions = await client.suggestedQuestions()
```

The transport is injectable, so tests swap the network out:

```ts
const client = new OfficialZhihuClient({
  accessSecret: 'secret',
  fetchImpl: async () => new Response(JSON.stringify({ data: { follower_count: 42 } })),
})
```

## The quota gate

Two guards sit in front of the platform's own free allowance:

1. The **local daily cap** (`dailyCallLimit`) counts every request and stops
   the pull with `ZHIHU_DAILY_CAP_REACHED` once it is reached. It resets on
   each calendar day.
2. The **platform reading** is cached per day. When it reports no remaining
   allowance, further calls fail with `ZHIHU_QUOTA_EXHAUSTED` instead of
   burning the rest of the day.

The request interval (`minIntervalMs`) spaces every call, and all requests run
on one serialized chain, so the gap holds even under concurrency.

## Errors

```ts
import { ZhihuError, ZhihuErrorCode } from '@veren/zhihu-client'

try {
  await client.accountStats()
} catch (error) {
  if (error instanceof ZhihuError && error.code === ZhihuErrorCode.AuthRejected) {
    // the access secret was rejected — re-authenticate
  }
}
```

## Notes

- The access secret is the platform's own credential, created in the developer
  center. This library never persists it; storing it is the caller's job.
- Only reads happen here. Publishing, commenting, and following are out of
  scope on purpose: they carry account risk that a read-only analysis tool
  does not need to take.
