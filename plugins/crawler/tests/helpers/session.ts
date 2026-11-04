import { vi } from 'vitest'
import type { BrowserContextLike, BrowserSession, PageLike } from '../../src/browser/contract.ts'

// 测试假体：会话/上下文/页面的一次性替身，供各 spec 复用（避免各写一份）。
// Test doubles: one-shot fakes for sessions, contexts and pages, shared by
// the specs instead of being re-implemented per file.

/** 假页面 / a fake page */
export function fakePage(): PageLike {
  return { goto: async () => undefined, content: async () => '', evaluate: async <T = unknown>(_script: string) => undefined as never }
}

/** 假上下文（可覆写单个方法）/ a fake context (single methods overridable) */
export function fakeContext(overrides: Partial<BrowserContextLike> = {}): BrowserContextLike {
  return {
    newPage: async () => fakePage(),
    pages: async () => [fakePage()],
    addCookies: async () => {},
    cookies: async () => [],
    requestJson: async () => ({}),
    close: async () => {},
    ...overrides,
  }
}

/** 假会话（关闭可观测）/ a fake session (observable close) */
export function fakeSession(overrides: Partial<BrowserContextLike> = {}): BrowserSession {
  return { context: fakeContext(overrides), close: vi.fn(async () => {}) }
}
