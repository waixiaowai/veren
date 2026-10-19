# @veren/im-testkit

Programmable fake IM provider and a reusable conformance suite for `@veren/im`.

## When to use it

Use it when you need to prove provider behavior without a real account, or when
you are adding a channel and want the same contract checks the fake provider
already passes.

## Fake provider

`createFakeProvider(options)` returns a `FakeProvider` with:

- `provider`: the `ImProvider` descriptor to register.
- `emit(message)`: deliver one inbound message; duplicate ids are ignored.
- `confirmBind(account)`: move the last QR attempt to `bound`.
- `sent`: every captured `ImSendRequest`, in order.
- `rejectNext(error)`: make the next send fail.
- `splitText` bounds: pass `textChars` (default `1800`).

```ts
import { createFakeProvider } from '@veren/im-testkit'

const fake = createFakeProvider({ textChars: 20 })
await fake.provider.service.start()
const attempt = await fake.provider.service.bind({ method: 'qrcode' })
fake.confirmBind({ id: 'acc-1', displayName: 'Test', status: 'online' })
await attempt.wait()
await fake.emit({ ... })
```

## Conformance suite

`defineImConformance` declares six Vitest cases:

1. accounts are stable after authorization;
2. one inbound message is delivered exactly once;
3. `pending -> bound` resolves waiters, and `cancel` expires the attempt;
4. `send` honors the explicit target and segments long text;
5. disposing a listener stops delivery;
6. the bind state machine is reachable through the public service.

A provider supplies an `ImConformanceTarget` driver (provider descriptor, `sent`,
`emit`, `confirmBind`). The suite knows nothing about the underlying protocol.

```ts
import { defineImConformance } from '@veren/im-testkit'

defineImConformance({
  name: 'my-provider',
  create: () => myDriver(),
})
```

## Scope

The suite is synchronous and account-free. Real-network behavior (HTTP shape,
authentication, protocol-specific error codes) belongs to the provider's own
mock tests; see `@veren/im-wechat/tests/wechat.spec.ts`.

## Commands

```bash
pnpm --filter @veren/im-testkit test
pnpm --filter @veren/im-testkit typecheck
```
