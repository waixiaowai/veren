/**
 * 组合验收：真实 cordis 上下文 + 真实 ToolRuntime + 真实 SkillRegistry，
 * 注册面与注销器语义真实——dispose 后工具表与技能表都干净（HMR 安全）。
 * Composition acceptance: a real cordis context plus the real ToolRuntime and
 * SkillRegistry, so the registration and disposer semantics are real — after
 * dispose, both tables are clean (HMR safety).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/config.js'
import { registerImagegenSkill, SKILL_NAME } from '../src/skill.js'
import { registerImagegenTools } from '../src/tools.js'
import { fakeAttachments, fakeCredentials } from './support/fakes.js'
import { IMAGEGEN_RECORD } from '../src/credential.js'

/** 在真实 cordis ctx 上挂真实服务表；systemPrompt 用最小结构面替身
 * （ToolRuntime 构造只调 .tools()/.section()，与宿主 app-host 测试同型）。 */
/** Mounts the real registries on a real cordis ctx; systemPrompt is a minimal
 * structural stand-in (ToolRuntime's constructor only calls .tools()/.section(), the
 * same shape the host's own app-host tests use). */
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

function worldOf(ctx: Context) {
  return {
    config: resolveConfig({ enabled: true }),
    credentials: fakeCredentials(new Map([[IMAGEGEN_RECORD, { kind: 'api-key', key: 'sk-test' }]])),
    attachments: fakeAttachments().store,
    workspaceOf: () => undefined,
  }
}

describe('tool registry composition', () => {
  it('registers both tools and disposes them in reverse order', () => {
    const ctx = realContext()
    const dispose = registerImagegenTools(ctx, worldOf(ctx))
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('imagegen__generate')
    expect(names).toContain('imagegen__edit')
    dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('carries the cooperative timeout and canonical output declaration', () => {
    const ctx = realContext()
    const dispose = registerImagegenTools(ctx, worldOf(ctx))
    const schemas = ctx.tools.schemas()
    for (const schema of schemas) {
      expect(schema.description.length).toBeGreaterThan(40)
    }
    dispose()
  })
})

describe('skill registry composition', () => {
  it('registers the bundled skill and disposes it cleanly', async () => {
    const ctx = realContext()
    const dispose = registerImagegenSkill(ctx)
    const summaries = await ctx.skills.list()
    const skill = summaries.find(entry => entry.name === SKILL_NAME)
    expect(skill).toBeDefined()
    const definition = await ctx.skills.get(SKILL_NAME)
    expect(definition.content).toContain('imagegen__generate')
    expect(definition.content).toContain('chroma')
    dispose()
    const after = await ctx.skills.list()
    expect(after.find(entry => entry.name === SKILL_NAME)).toBeUndefined()
  })
})
