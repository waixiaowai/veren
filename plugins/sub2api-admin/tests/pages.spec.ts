/**
 * 工具面口径（承诺=挂载）测试：九个页面组件体登记的工具、说明与正文互相咬合——
 * 挂了的工具说明必须点名，说明点名（非路由表述）的工具必须真挂载，应用工具全集
 * 里每个工具都至少挂在一个页面上（无死工具）。正文用真实组件经
 * defineComponentPage 挂载渲染（WYSIWYG）。
 * Tool-face doctrine (promise = mount) tests: the tools the nine page bodies
 * register, the instructions, and the bodies must interlock — every mounted
 * tool is named in the instructions, every (non-routing) named tool is really
 * mounted, and every app tool is mounted on at least one page (no dead tools).
 * Bodies render from the real components via defineComponentPage (WYSIWYG).
 */
import { describe, expect, it } from 'vitest'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import { Sub2AdminClient } from '../src/client.ts'
import {
  AccountsMeta, AccountsPage, APP_ID,
  bindSub2ApiRuntime, ChannelsMeta, ChannelsPage,
  CodesMeta, CodesPage, externalName, FinanceMeta, FinancePage,
  GroupsMeta, GroupsPage,
  HomeMeta, HomePage,
  SubscriptionsMeta, SubscriptionsPage,
  UsageMeta, UsagePage,
  UsersMeta, UsersPage,
} from '../src/pages.tsx'
import { Sub2ApiStore } from '../src/store.ts'
import { createAppTools } from '../src/tools.ts'

/** 空客户端：本文件只读结构，不发起任何请求 / a bare client: structure only, no requests */
const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com' })

/** 记录型 agent：组件体直登的全名定义是页面工具面的断言源
 * / a recording agent: the bodies' full-named registrations are the assertion source of a page's tool face */
function fakeAgent(): { agent: never; registered: string[] } {
  const registered: string[] = []
  const agent = {
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          registered.push(definition.name)
          return () => undefined
        },
      },
      effect: () => async () => undefined,
      on: () => () => undefined,
    },
    session: { id: 'spec' },
  }
  return { agent: agent as never, registered }
}

// 绑定装配槽位（真 store + 全名工具），与 index.ts 的装配同一形状
// / bind the assembly slot (real store + full-named tools), the same shape as index.ts's wiring
const store = new Sub2ApiStore()
bindSub2ApiRuntime(store, createAppTools(client, store).map((tool) => ({ ...tool, name: externalName(tool.name) })))

/** 九页（名, 组件, meta, 正文带配套工具行）/ the nine pages (name, component, meta, body carries the tool line) */
const rows = [
  ['home', HomePage, HomeMeta, false], ['channels', ChannelsPage, ChannelsMeta, true],
  ['groups', GroupsPage, GroupsMeta, true], ['users', UsersPage, UsersMeta, true],
  ['subscriptions', SubscriptionsPage, SubscriptionsMeta, true], ['finance', FinancePage, FinanceMeta, false],
  ['codes', CodesPage, CodesMeta, false], ['accounts', AccountsPage, AccountsMeta, true],
  ['usage', UsagePage, UsageMeta, false],
] as Array<[string, PageFC, ComponentPageMeta, boolean]>

/** 一页的投影：真实组件挂载恰好一次 → （名, 挂载全名集, 说明, 正文）
 * / one page's projection: mount the real component exactly once → (name, mounted full names, instructions, body) */
function pageRow(name: string, component: PageFC, meta: ComponentPageMeta, toolLine: boolean): {
  name: string
  mounted: readonly string[]
  instructions: string
  body: string
  toolLine: boolean
} {
  const { agent, registered } = fakeAgent()
  const body = defineComponentPage(component, meta).live.mount({}, agent)
  return { name, mounted: [...registered], instructions: meta.instructions ?? '', body, toolLine }
}

/** 九页投影 / all nine page projections */
function pageRows(): Promise<Array<Awaited<ReturnType<typeof pageRow>>>> {
  return Promise.all(rows.map(([name, component, meta, toolLine]) => pageRow(name, component, meta, toolLine)))
}

describe('工具面口径（承诺=挂载）', () => {
  it('页面=信息+工具，缺一不可：每页说明非空且组件体至少登记一个工具', async () => {
    for (const row of await pageRows()) {
      expect(row.instructions.trim().length, `${row.name} 页缺页面说明`).toBeGreaterThan(0)
      expect(row.mounted.length, `${row.name} 页组件体未登记任何工具`).toBeGreaterThan(0)
    }
  })

  it('每页挂载的工具都在说明里点名（挂了就要说）', async () => {
    for (const row of await pageRows()) {
      for (const full of row.mounted) {
        const local = full.replace(`${externalName('')}`, '')
        expect(row.instructions, `${row.name} 页挂载的 ${local} 未在说明中点名`).toContain(local)
      }
    }
  })

  it('listPage 正文的「配套工具」行列出该页全部挂载工具的外名', async () => {
    // 正文是 Markdown：下划线会被转义（sub2api\_admin），比对前剥掉转义反斜杠。
    // / Bodies are Markdown: underscores get escaped (sub2api\_admin), so strip
    // escape backslashes before comparing.
    for (const row of (await pageRows()).filter((entry) => entry.toolLine)) {
      const plain = row.body.replaceAll('\\', '')
      for (const full of row.mounted) {
        expect(plain, `${row.name} 页正文缺 ${full} 的外名`).toContain(full)
      }
    }
  })

  it('应用工具全集里每个工具都至少挂在一个页面上（无死工具；普通会话看不见应用工具）', async () => {
    const mounted = new Set((await pageRows()).flatMap((row) => [...row.mounted]))
    for (const tool of createAppTools(client, store)) {
      expect(mounted.has(externalName(tool.name)), `应用工具 ${tool.name} 没有挂载在任何页面`).toBe(true)
    }
  })

  it('组件体登记没有越出应用工具全集（无凭空注册；普通会话看不见应用工具）', async () => {
    const catalog = new Set(createAppTools(client, store).map((tool) => externalName(tool.name)))
    for (const row of await pageRows()) {
      for (const full of row.mounted) {
        expect(catalog.has(full), `${row.name} 页登记了全集之外的 ${full}`).toBe(true)
      }
    }
  })

  it('channels 页点名的 request 工具真挂在本页（说明点名 ⊆ 挂载）', async () => {
    // 此前 channels 说明让模型用 request 走 channel-monitors 端点，但该页只挂了
    // channels——承诺≠挂载。回归锁：点名了就得挂。
    // / The channels instructions once told the model to use request for
    // channel-monitors while mounting only channels — promise ≠ mount. The
    // regression lock: a named tool must be mounted.
    const channels = (await pageRows()).find((row) => row.name === 'channels')
    expect(channels?.mounted).toContain(externalName('channels'))
    expect(channels?.mounted).toContain(externalName('request'))
  })

  it('finance 页挂载的 overview 在说明里点名（挂了就要说）', async () => {
    // 此前 finance 挂了 overview 却只在正文读首页支付切片——模型不知道刷新入口。
    // / finance once mounted overview while reading the home payment slice
    // without ever naming it — the model had no visible refresh entry.
    const finance = (await pageRows()).find((row) => row.name === 'finance')
    expect(finance?.mounted).toContain(externalName('overview'))
    expect(finance?.instructions).toContain('overview')
  })

  it(`应用 id 与工具前缀一致（${APP_ID}）`, () => {
    expect(APP_ID).toBe('sub2api-admin')
    expect(externalName('overview')).toBe('sub2api_admin__overview')
  })
})
