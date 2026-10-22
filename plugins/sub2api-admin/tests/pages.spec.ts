/**
 * 工具面口径（承诺=挂载）测试：九个页面的 meta.tools 与说明、正文互相咬合——
 * 挂了的工具说明必须点名，说明点名（非路由表述）的工具必须真挂载，目录里的
 * 每个工具都至少挂在一个页面上（无死工具）。正文用真实组件挂载渲染（WYSIWYG）。
 * Tool-face doctrine (promise = mount) tests: the nine pages' meta.tools,
 * instructions, and bodies must interlock — every mounted tool is named in the
 * instructions, every (non-routing) named tool is really mounted, and every
 * catalog tool is mounted on at least one page (no dead tools). Bodies render
 * from the real components (WYSIWYG).
 */
import { describe, expect, it } from 'vitest'

import { defineComponentPage, isMarkdownDocHost } from '@veren/prompt-page'

import { Sub2AdminClient } from '../src/client.ts'
import { createSub2ApiPages } from '../src/pages.tsx'
import type { PageFC } from '@veren/prompt-page'
import { Sub2ApiStore } from '../src/store.ts'
import { APP_ID, createAppTools } from '../src/tools.ts'

/** 空客户端：本文件只读结构，不发起任何请求 / a bare client: structure only, no requests */
const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com' })

/** 九页契约面（组件 + meta 成对）与目录工具名 / the nine paired page faces plus catalog tool names */
const pages = createSub2ApiPages(new Sub2ApiStore())
const catalog = createAppTools(client, new Sub2ApiStore()).map((tool) => tool.name)

/** 每页的（名, 挂载工具, 说明, 真实正文）投影；toolLine = listPage 构造（正文带「配套工具」行）
 * / the per-page (name, tools, instructions, real body) projection; toolLine =
 * built by listPage (the body carries the 配套工具 line) */
const rows = [
  ['home', pages.HomePage, pages.HomeMeta, false], ['channels', pages.ChannelsPage, pages.ChannelsMeta, true],
  ['groups', pages.GroupsPage, pages.GroupsMeta, true], ['users', pages.UsersPage, pages.UsersMeta, true],
  ['subscriptions', pages.SubscriptionsPage, pages.SubscriptionsMeta, true], ['finance', pages.FinancePage, pages.FinanceMeta, false],
  ['codes', pages.CodesPage, pages.CodesMeta, false], ['accounts', pages.AccountsPage, pages.AccountsMeta, true],
  ['usage', pages.UsagePage, pages.UsageMeta, false],
] as Array<[string, PageFC, typeof pages.HomeMeta, boolean]>

function pageRows(): Array<{ name: string; tools: readonly string[]; instructions: string; body: string; toolLine: boolean }> {
  return rows.map(([name, component, meta, toolLine]) => {
    const view = defineComponentPage(component, meta).live.mount({})
    return {
      name,
      tools: meta.tools ?? [],
      instructions: meta.instructions ?? '',
      body: isMarkdownDocHost(view.host) ? view.host.bodyText() : '',
      toolLine,
    }
  })
}

describe('工具面口径（承诺=挂载）', () => {
  it('页面=信息+工具，缺一不可：每页说明非空且至少挂载一个工具', () => {
    for (const row of pageRows()) {
      expect(row.instructions.trim().length, `${row.name} 页缺页面说明`).toBeGreaterThan(0)
      expect(row.tools.length, `${row.name} 页缺挂载工具`).toBeGreaterThan(0)
    }
  })

  it('每页挂载的工具都在说明里点名（挂了就要说）', () => {
    for (const row of pageRows()) {
      for (const tool of row.tools) {
        expect(row.instructions, `${row.name} 页挂载的 ${tool} 未在说明中点名`).toContain(tool)
      }
    }
  })

  it('listPage 正文的「配套工具」行列出该页全部挂载工具的外名', () => {
    // 正文是 Markdown：下划线会被转义（sub2api\_admin），比对前剥掉转义反斜杠。
    // / Bodies are Markdown: underscores get escaped (sub2api\_admin), so strip
    // escape backslashes before comparing.
    for (const row of pageRows().filter((entry) => entry.toolLine)) {
      const plain = row.body.replaceAll('\\', '')
      for (const tool of row.tools) {
        expect(plain, `${row.name} 页正文缺 ${tool} 的外名`).toContain(`sub2api_admin__${tool}`)
      }
    }
  })

  it('目录里每个工具都至少挂在一个页面上（无死工具；普通会话看不见应用工具）', () => {
    const mounted = new Set(pageRows().flatMap((row) => [...row.tools]))
    for (const tool of catalog) {
      expect(mounted.has(tool), `目录工具 ${tool} 没有挂载在任何页面`).toBe(true)
    }
  })

  it('channels 页点名的 request 工具真挂在本页（说明点名 ⊆ 挂载）', () => {
    // 此前 channels 说明让模型用 request 走 channel-monitors 端点，但该页只挂了
    // channels——承诺≠挂载。回归锁：点名了就得挂。
    // / The channels instructions once told the model to use request for
    // channel-monitors while mounting only channels — promise ≠ mount. The
    // regression lock: a named tool must be mounted.
    const channels = pageRows().find((row) => row.name === 'channels')
    expect(channels?.tools).toContain('channels')
    expect(channels?.tools).toContain('request')
  })

  it('finance 页挂载的 overview 在说明里点名（挂了就要说）', () => {
    // 此前 finance 挂了 overview 却只在正文读首页支付切片——模型不知道刷新入口。
    // / finance once mounted overview while reading the home payment slice
    // without ever naming it — the model had no visible refresh entry.
    const finance = pageRows().find((row) => row.name === 'finance')
    expect(finance?.tools).toContain('overview')
    expect(finance?.instructions).toContain('overview')
  })

  it(`应用 id 与工具前缀一致（${APP_ID}）`, () => {
    expect(APP_ID).toBe('sub2api-admin')
  })
})
