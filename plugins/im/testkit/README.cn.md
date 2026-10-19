# @veren/im-testkit

`@veren/im` 的可编程假 provider 与可复用契约测试套件。

## 什么时候使用

需要在不使用真实账号的情况下证明 provider 行为，或新增渠道并希望跑与假 provider 相同的契约检查时使用。

## 假 provider

`createFakeProvider(options)` 返回一个 `FakeProvider`：

- `provider`：可注册的 `ImProvider` 描述符。
- `emit(message)`：投递一条入站消息；重复 id 会被忽略。
- `confirmBind(account)`：把最近一次二维码尝试推进到 `bound`。
- `sent`：按顺序记录每一次 `ImSendRequest`。
- `rejectNext(error)`：让下一次发送失败。
- `textChars`：分段上限（默认 `1800`）。

```ts
import { createFakeProvider } from '@veren/im-testkit'

const fake = createFakeProvider({ textChars: 20 })
await fake.provider.service.start()
const attempt = await fake.provider.service.bind({ method: 'qrcode' })
fake.confirmBind({ id: 'acc-1', displayName: 'Test', status: 'online' })
await attempt.wait()
await fake.emit({ ... })
```

## 契约套件

`defineImConformance` 声明六个 Vitest 用例：

1. 授权后账号列表稳定；
2. 同一条入站消息只投递一次；
3. `pending -> bound` 会结算等待者，`cancel` 会过期；
4. `send` 遵守显式 target，并对长文本分段；
5. dispose 监听器后停止投递；
6. 绑定状态机可通过公开服务到达。

provider 提供 `ImConformanceTarget` 驱动（provider 描述符、`sent`、`emit`、`confirmBind`）。
套件不关心底层协议。

```ts
import { defineImConformance } from '@veren/im-testkit'

defineImConformance({
  name: 'my-provider',
  create: () => myDriver(),
})
```

## 范围

套件是同步、无账号的。真实网络行为（HTTP 形状、鉴权、协议错误码）由 provider 自己的 mock 测试覆盖；
参见 `@veren/im-wechat/tests/wechat.spec.ts`。

## 命令

```bash
pnpm --filter @veren/im-testkit test
pnpm --filter @veren/im-testkit typecheck
```
