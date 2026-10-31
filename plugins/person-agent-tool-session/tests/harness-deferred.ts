// 可从外部结清的 promise：假 Agent 的 whenIdle 与观察令牌都靠它手动推进。
// A promise settleable from the outside: the fake Agent's whenIdle and the
// observation token both advance through it.
/** 一个可以从外部结清的 promise。A promise an outside caller can settle. */
export interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

/**
 * 建一个可以从外部结清的 promise。Build a promise an outside caller can settle.
 * @returns 结清句柄。The settle handle.
 */
export function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}
