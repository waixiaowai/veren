/**
 * 目录解析规格：fixture 回放两区域形状、花名册交集、促销时钟重估、计费归一。
 * Catalog-parsing specs: fixture replay of both region shapes, roster
 * intersection, promotion clock re-evaluation, credits normalization.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { modelWithCurrentPromotion, normalizeCredits, parseModelCatalog } from '../src/index.ts'

describe('CN 形状（信封）/ CN shape (envelope)', () => {
  it('fixture 回放：花名册 ∩ 可用行（retired 与 disabled 行剔除）', async () => {
    const document = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'catalog-cn.json'), 'utf8')) as Record<string, unknown>
    const models = parseModelCatalog(document['data'] as Record<string, unknown>, false)
    expect(models.map(model => model.id)).toEqual(['glm-5.3-flash', 'deepseek-v4.1-flash'])
    // `x0.06 credits` 规范化为语言中立显示形。
    expect(models[0]?.billing).toMatchObject({ credits: 'x0.06 credits', free: false })
    // effort 缺省拼写（`effort` 而非 `defaultEffort`）也收。
    expect(models[1]?.reasoning).toMatchObject({ supports: true, defaultEffort: 'high', canDisableThinking: false })
    // CN 行没有窗口对象，contextWindow 落 maxInputTokens。
    expect(models[0]?.contextWindow).toBe(1_000_000)
    expect(models[0]?.supportedContextWindows).toBeUndefined()
  })
})

describe('国际形状（裸文档）/ international shape (bare document)', () => {
  it('fixture 回放：窗口对象、modelPromotions 时钟重估', async () => {
    const document = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'catalog-global.json'), 'utf8')) as Record<string, unknown>
    const models = parseModelCatalog(document, true)
    expect(models).toHaveLength(3)
    const luna = models[0]
    expect(luna?.contextWindow).toBe(1_000_000)
    expect(luna?.supportedContextWindows).toEqual([1_000_000])
    // glm-5.3 带 in-force 的 replace:0 促销 → 免费并带标签（2026 时钟下生效期内）。
    const glm = modelWithCurrentPromotion(models[1] as never, Date.parse('2026-06-01T00:00:00Z'))
    expect(glm.billing).toMatchObject({ free: true, credits: 'x0.00' })
    expect(glm.billing?.badges).toContain('Free now')
    // fast-model 的促销已过期 → 收声：不免费、rateUnknown、摘标签。
    const fast = modelWithCurrentPromotion(models[2] as never, Date.parse('2026-06-01T00:00:00Z'))
    expect(fast.billing).toMatchObject({ free: false, rateUnknown: true })
    expect(fast.billing?.badges).toBeUndefined()
  })
})

describe('normalizeCredits / 计费归一', () => {
  it('去掉尾部单位词；纯单位词与空串都无效', () => {
    expect(normalizeCredits('x0.79 credits')).toBe('x0.79')
    expect(normalizeCredits('x0.79')).toBe('x0.79')
    expect(normalizeCredits('credits')).toBeUndefined()
    expect(normalizeCredits(undefined)).toBeUndefined()
  })
})

describe('硬错误 / hard errors', () => {
  it('花名册缺失或交集为空是硬错误（空目录必须显式，绝不伪装正常）', () => {
    expect(() => parseModelCatalog({ models: [] }, false)).toThrow('no cli agent models')
    expect(() => parseModelCatalog({ models: [], agents: [{ name: 'cli', models: ['x'] }] }, false)).toThrow('resolved to an empty list')
  })
})
