import { describe, expect, it } from 'vitest'
import { defineAppPage, definePage, pageToolWarning } from '../src/index.ts'
import {
  APPS_URL_PREFIX,
  RESERVED_APP_IDS,
  assertAppUrlPattern,
  assertParamsMatchPattern,
  isAppUrlPattern,
  isValidAppId,
  pageArchetypeOf,
  patternParamsOf,
} from '../src/contract.ts'
import type { PageDefinition } from '../src/index.ts'

describe('应用作用域 URL 形态（§6.1）', () => {
  it('isValidAppId：slug 规则 + 保留字', () => {
    expect(isValidAppId('review-workbench')).toBe(true)
    expect(isValidAppId('a')).toBe(true)
    expect(isValidAppId('Review')).toBe(false)
    expect(isValidAppId('1abc')).toBe(false)
    expect(isValidAppId('a_b')).toBe(false)
    expect(isValidAppId('a'.repeat(33))).toBe(false)
    for (const reserved of RESERVED_APP_IDS) expect(isValidAppId(reserved)).toBe(false)
  })

  it('assertAppUrlPattern：/apps/<appId>/... 形态 + :param 规则', () => {
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/review/:pr')).not.toThrow()
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench')).not.toThrow()
    expect(isAppUrlPattern('/apps/review-workbench/review/:pr')).toBe(true)
    expect(isAppUrlPattern(APPS_URL_PREFIX + '/a')).toBe(true)

    expect(() => assertAppUrlPattern('p', '/task-list')).toThrow(/must start with/)
    expect(() => assertAppUrlPattern('p', '/apps')).toThrow(/must start with/)
    expect(() => assertAppUrlPattern('p', '/apps/api/x')).toThrow(/invalid app id/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/apps/x')).toThrow(/"apps" segment/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x?y=1')).toThrow(/query or fragment/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x/:a/:a')).toThrow(/duplicate :param/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x/:')).toThrow(/invalid or duplicate :param/)
  })
})

describe('defineAppPage（应用作用域契约）', () => {
  const title = (params: { pr?: string }) => `审阅 PR #${params.pr ?? '?'}`
  const good = {
    name: 'review',
    url: '/apps/review-workbench/review/:pr',
    description: '审阅一个 PR 的改动',
    // 详情页规则 3（说明半边）：writes + 说明缺一不可；工具半边在挂载期判
    // / detail rule 3 (instructions half): writes + instructions; the tool half is judged at mount
    writes: true,
    instructions: '先读 diff，再给结论。',
    instanceTitle: title as never,
  }

  it('合法：契约字段原样保留', () => {
    const page = defineAppPage(good)
    expect(page.url).toBe('/apps/review-workbench/review/:pr')
    expect(page.instructions).toBe('先读 diff，再给结论。')
    expect(page.instanceTitle?.({ pr: '42' })).toBe('审阅 PR #42')
  })

  it('缺省补齐：页面定义不再携带工具清单（工具只在页面存在，组件体登记）', () => {
    // 设计律：工具清单随目录机制一并退役，页面定义里没有 tools 字段
    // / design law: the tool list retired with the catalog mechanism; the page definition carries no tools field
    const page = defineAppPage({
      ...good, url: '/apps/review-workbench/list',
      writes: false, instructions: undefined,
    })
    expect('tools' in page).toBe(false)
  })

  it('URL 非 /apps 形态 → fail loud（definePage 不做此校验，保证迁移期兼容）', () => {
    expect(() => defineAppPage({ ...good, url: '/review/:pr' })).toThrow(/must start with/)
    expect(() => definePage({ ...good, url: '/review/:pr' })).not.toThrow()
  })
})

describe('两轴四档页面校验（§3.10.5）', () => {
  const home = {
    name: 'list',
    url: '/apps/review-workbench/list',
    description: '审阅列表',
    instructions: '浏览全部审阅。',
  }

  it('viewer 档（只读详情）：带 :param、不声明 writes → 如实注册，不再被迫谎称要写', () => {
    // 上一轮留下的空隙：只读详情页（有记录身份、纯浏览不做事）被规则 3 逼着
    // 声明 writes: true 才能注册——那是在教人写假声明。现在它是合法的 viewer。
    // / the gap the previous round left: a read-only drilldown (record identity,
    // nothing to do) had to claim writes: true to register — teaching fake
    // declarations. It is now a legal viewer.
    const viewer = defineAppPage({
      name: 'workspace', url: '/apps/review-workbench/workspace/:wsId', description: '工作区只读下钻',
    })
    expect(viewer.writes).toBeUndefined()
    // 设计律：页面定义没有工具清单——viewer 想要读工具就在组件体登记
    // / design law: no tool list on the page definition — a viewer registers read tools in its body if it wants them
    expect('tools' in viewer).toBe(false)
    // 显式 writes: false 与缺省同义 / an explicit writes: false reads as read-only
    expect(() => defineAppPage({ ...viewer, writes: false })).not.toThrow()
  })

  it('规则 3（说明半边）：声明 writes: true 的带参页缺说明 → page/detail-invalid；工具半边移挂载期', () => {
    // 规则 3 的说明半边留在注册期；工具半边（至少登记一个工具）由 page-registry
    // 在挂载期以真实登记面判——注册期看不到 ctx.page.tool。
    // / rule 3's instructions half stays at registration; the tool half (at
    // least one recorded tool) is judged at mount by page-registry over the
    // really-collected face — registration never sees ctx.page.tool.
    expect(() => defineAppPage({ ...home, name: 'd3', url: '/apps/review-workbench/review/:pr', writes: true, instructions: ' ' }))
      .toThrowError(expect.objectContaining({ code: 'page/detail-invalid' }))
    // 合规详情页照常通过 / a compliant detail page passes
    expect(() => defineAppPage({
      ...home, name: 'd0', url: '/apps/review-workbench/review/:pr',
      writes: true, instructions: '只处理这一条审阅。',
    })).not.toThrow()
  })

  it('规则 2（不校验）：首页/只读副页没有写工具也不报警——pageToolWarning 只认 writes: true 声明', () => {
    // 首页与只读副页不声明 writes → 装配期完备性警告对它们天然沉默（见下方规则 3b 用例）
    // / home and read-only secondary pages declare no writes → the assembly
    // warning stays silent for them (see the rule 3b case below)
    expect(() => defineAppPage(home)).not.toThrow()
  })

  it('规则 1/4 的静态面：patternParamsOf 区分无参（首页/工具页）与带参（详情页）', () => {
    expect(patternParamsOf('/apps/x/list')).toEqual([])
    expect(patternParamsOf('/apps/x/review/:pr')).toEqual(['pr'])
    expect(patternParamsOf('/apps/x/a/:one/b/:two')).toEqual(['one', 'two'])
  })

  it('规则 5（挂载期）：params 缺模式声明的 :param → page/params-mismatch fail loud；额外查询键合法', () => {
    expect(() => assertParamsMatchPattern('/apps/x/review/:pr', { pr: '7' })).not.toThrow()
    expect(() => assertParamsMatchPattern('/apps/x/review/:pr', { pr: '7', focus: 'chat' })).not.toThrow()
    expect(() => assertParamsMatchPattern('/apps/x/review/:pr', {})).toThrowError(expect.objectContaining({ code: 'page/params-mismatch' }))
  })
})

describe('两轴四档分类（§3.10.1，pageArchetypeOf）', () => {
  it('推导：带 :param 写 → detail；带 :param 只读 → viewer；无参 entry → home；无参非入口写 → action；无参非入口只读 → readonly', () => {
    expect(pageArchetypeOf({ name: 'detail', url: '/apps/x/task/:taskId', writes: true }, 'list')).toBe('detail')
    // viewer：只读详情（/workspace/:wsId 下钻形态）——本轮补上的最后一格
    // / viewer: the read-only drilldown (the /workspace/:wsId shape) — the last cell, added this round
    expect(pageArchetypeOf({ name: 'ws', url: '/apps/x/workspace/:wsId' }, 'list')).toBe('viewer')
    expect(pageArchetypeOf({ name: 'list', url: '/apps/x/list' }, 'list')).toBe('home')
    expect(pageArchetypeOf({ name: 'publish', url: '/apps/x/publish', writes: true }, 'list')).toBe('action')
    // 只读副页：person-agent 的工作区浏览页形态 / a read-only secondary page: person-agent's workspace browser
    expect(pageArchetypeOf({ name: 'workspaces', url: '/apps/x/workspaces' }, 'overview')).toBe('readonly')
    // 不知道入口（裸注册）：无参页面不判 home / without the entry (raw registration): never home
    expect(pageArchetypeOf({ name: 'list', url: '/apps/x/list' })).toBe('readonly')
  })
})

describe('规则 3b：工具页必须有写工具——警告通道，不是门禁', () => {
  const action = {
    name: 'publish',
    url: '/apps/x/publish',
    description: '发布一条新任务',
    instructions: '用 publish_task 确认发布；标题为空时不要调用。',
  }

  it('工具页（无参非入口 writes: true）合法注册，但真实挂载面为空会被 pageToolWarning 警告', () => {
    // 判据在挂载期：mountedTools 是"静态声明 + 组件体动态登记"的并集数量，
    // 注册期只看静态声明，看不到 ctx.page.tool，在那里判必然误报。
    // / the verdict lives at mount: mountedTools counts the union of static
    // declarations and the body's dynamic records — registration time never
    // sees ctx.page.tool, so judging there is a guaranteed false positive.
    const silent = defineAppPage({ ...action, writes: true })
    expect(pageToolWarning(silent, 0)).toContain('declares writes: true but mounts no tools')
    // 声明清单已不存在：唯一判据是真实挂载面数量 / the declaration list is gone: the only verdict input is the really-mounted count
    expect(pageToolWarning(silent, 1)).toBeUndefined()
  })
})
