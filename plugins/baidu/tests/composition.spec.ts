/** 组合验收：真实 cordis ctx + 真实 ToolRuntime + 真实 SkillRegistry + 假凭据面——注册与逆序注销语义真实（HMR 安全）。 */
/** Composition acceptance: a real cordis ctx plus the real ToolRuntime and SkillRegistry and a fake credential face — registration and reverse-order disposal semantics are real (HMR safety). */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/config.js'
import { commitTokens, readStoredTokens, BAIDU_PAN_RECORD } from '../src/credentials.js'
import { registerBaiduPanSkill, SKILL_NAME } from '../src/skill.js'
import { registerManageTools } from '../src/tools-manage.js'
import { registerReadonlyTools } from '../src/tools-readonly.js'
import { registerShareTool } from '../src/tools-share.js'
import { registerTransferTools } from '../src/tools-transfer.js'
import { buildWorld } from '../src/world.js'
import { tokenedCredentials } from './support/fakes.js'

/** 在真实 cordis ctx 上挂真实服务表（systemPrompt 用最小结构面替身，与宿主 app-host 测试同型）。 */
/** Mounts the real registries on a real cordis ctx (systemPrompt is a minimal structural stand-in, the host app-host tests' shape). */
function realContext(): Context {
  const ctx = new Context()
  const disposer = () => () => {}
  ;(ctx as unknown as Record<string, unknown>).systemPrompt = {
    tools: () => disposer(),
    section: () => disposer(),
  }
  new ToolRuntime(ctx)
  new SkillRegistry(ctx)
  return ctx
}

/** 组装接在假凭据面上的编排世界。Assembles the world wired onto the fake credential face. */
function worldOf(ctx: Context): ReturnType<typeof buildWorld> {
  return buildWorld(resolveConfig({ appKey: 'k', secretKey: 's' }), ctx.credentials, { list: () => [] })
}

describe('tool registry composition', () => {
  it('registers all thirteen tools and disposes them cleanly', () => {
    const ctx = realContext()
    const world = worldOf(ctx)
    const disposers = [
      registerReadonlyTools(ctx, world),
      registerManageTools(ctx, world),
      registerShareTool(ctx, world),
      registerTransferTools(ctx, world),
    ]
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining([
      'baidu_pan__whoami', 'baidu_pan__quota', 'baidu_pan__list', 'baidu_pan__search', 'baidu_pan__meta',
      'baidu_pan__mkdir', 'baidu_pan__copy', 'baidu_pan__move', 'baidu_pan__rename', 'baidu_pan__delete',
      'baidu_pan__share', 'baidu_pan__upload', 'baidu_pan__download',
    ]))
    expect(names).toHaveLength(13)
    for (const dispose of disposers.reverse()) dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('projects a self-explanatory model face on every tool schema', () => {
    const ctx = realContext()
    const world = worldOf(ctx)
    const disposers = [
      registerReadonlyTools(ctx, world),
      registerManageTools(ctx, world),
      registerShareTool(ctx, world),
      registerTransferTools(ctx, world),
    ]
    // schemas() 只白名单模型面字段：name/description/parameters 必须自解释。
    // schemas() whitelists the model face only: name/description/parameters must be self-explanatory.
    for (const schema of ctx.tools.schemas()) {
      expect(schema.description.length).toBeGreaterThan(40)
      expect(Object.keys(schema.parameters)).toBeDefined()
    }
    for (const dispose of disposers.reverse()) dispose()
  })
})

describe('skill registry composition', () => {
  it('registers the bundled skill and disposes it cleanly', async () => {
    const ctx = realContext()
    const dispose = registerBaiduPanSkill(ctx)
    const summaries = await ctx.skills.list()
    expect(summaries.find(entry => entry.name === SKILL_NAME)).toBeDefined()
    const definition = await ctx.skills.get(SKILL_NAME)
    expect(definition.content).toContain('baidu_pan__delete')
    expect(definition.content).toContain('BDPAN_OUTPUT_UNCERTAIN')
    dispose()
    const after = await ctx.skills.list()
    expect(after.find(entry => entry.name === SKILL_NAME)).toBeUndefined()
  })
})

describe('credential face', () => {
  it('round-trips tokens through the grant record', async () => {
    const credentials = tokenedCredentials()
    const tokens = await readStoredTokens(credentials)
    expect(tokens?.accessToken).toBe('test-access')
    await commitTokens(credentials, { ...tokens!, accessToken: 'next' })
    expect((await readStoredTokens(credentials))?.accessToken).toBe('next')
    expect(BAIDU_PAN_RECORD).toBeDefined()
  })
})
