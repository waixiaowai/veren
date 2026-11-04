import { describe, expect, it, vi } from 'vitest'
import { OverviewPage } from '../src/page-overview.tsx'
import { bindOverviewRuntime, provideToolStubs } from '../src/page-overview.tsx'
import { createCrawlerTools } from '../src/tools.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CrawlerManager } from '../src/control/manager.ts'
import type { CrawlerStore } from '../src/store/domain.ts'

// 总览页验收：页面会话必须挂载全部六工具（wordcloud 曾漏挂——本测试防回归）。
// Overview-page acceptance: the page session must mount all six tools
// (wordcloud was once missing — this test guards against regression).
function fakeAgent(registered: string[]): Agent {
  return {
    ctx: {
      tools: {
        register: (tool: ToolDefinition) => void registered.push(tool.name),
      },
      effect: vi.fn(),
    },
  } as unknown as Agent
}

function fakeRuntime() {
  return {
    manager: {
      status: () => ({ status: 'idle', platform: null, crawlerType: null, startedAt: null, errorMessage: null }),
      logs: { recent: () => [] },
    } as unknown as CrawlerManager,
    domain: () => ({ table: () => ({ put: async () => {}, entries: () => new Map().entries() }) }) as unknown as CrawlerStore,
  }
}

describe('overview page tool mounting', () => {
  it('mounts all six crawler__ tools into the page session', () => {
    const registered: string[] = []
    provideToolStubs(createCrawlerTools().map((tool) => ({ ...tool, name: `crawler__${tool.name}` })))
    bindOverviewRuntime(fakeRuntime())
    OverviewPage({}, fakeAgent(registered))
    for (const tool of ['start', 'stop', 'status', 'logs', 'data', 'wordcloud']) {
      expect(registered).toContain(`crawler__${tool}`)
    }
  })
})
