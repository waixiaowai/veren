/**
 * @veren/im-testkit: fake provider plus the reusable conformance suite.
 *
 * @veren/im-testkit：假 provider 与可复用契约测试套件。
 *
 * @module @veren/im-testkit
 */

export { FakeBindAttempt, FakeProvider, createFakeProvider, splitText } from './fake-provider.ts'
export type { FakeProviderOptions } from './fake-provider.ts'
export { defineImConformance } from './conformance.ts'
export type { ImConformanceOptions, ImConformanceTarget } from './conformance.ts'
