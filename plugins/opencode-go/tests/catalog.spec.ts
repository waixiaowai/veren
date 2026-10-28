/**
 * 目录合并语义：静态目录为体、在线目录定序增补不收缩、未知 id 透传、
 * 精确元数据容量正确。
 * Catalog merge semantics: the static catalog is the body, the online listing
 * orders and appends without shrinking, unknown ids pass through, and exact
 * metadata carries correct capacities.
 *
 * @module @veren/opencode-go/tests
 */
import { describe, expect, it } from 'vitest'
import { GoCatalog, OPENCODE_GO_PROVIDER } from '../src/catalog.js'
import { OPENCODE_GO_CATALOG } from '../src/catalog-data.js'
import { resolveConfig } from '../src/config.js'
import { ListingClient, parseListing } from '../src/listing.js'
import { startMockGateway } from './support/mock-gateway.js'

const config = resolveConfig({})

function makeCatalog(): GoCatalog {
  return new GoCatalog(config, new ListingClient(config))
}

describe('GoCatalog', () => {
  it('未加载在线目录时按静态快照顺序暴露全部模型', () => {
    const catalog = makeCatalog()
    const models = catalog.listModels()
    expect(models.map((model) => model.id)).toEqual(OPENCODE_GO_CATALOG.map((entry) => entry.id))
    expect(models.every((model) => model.provider === OPENCODE_GO_PROVIDER)).toBe(true)
  })

  it('在线目录定序并增补未知 id，静态目录不收缩（尾部保留）', () => {
    const catalog = makeCatalog()
    catalog.noteListing(['glm-5.3-flash', 'brand-new-model', 'deepseek-v4.1-flash'])
    const ids = catalog.listModels().map((model) => model.id)
    expect(ids.slice(0, 3)).toEqual(['glm-5.3-flash', 'brand-new-model', 'deepseek-v4.1-flash'])
    expect(ids).toContain('kimi-k3')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('静态已知模型的精确元数据带容量；未知 id 以文本保底透传', () => {
    const catalog = makeCatalog()
    const known = catalog.resolveModel(OPENCODE_GO_PROVIDER, 'deepseek-v4.1-flash')
    expect(known.context).toEqual({ contextWindow: 1_000_000 })
    expect(known.defaultMaxTokens).toBe(384_000)
    expect(known.inputModalities).toEqual(['text', 'image'])
    const unknown = catalog.resolveModel(OPENCODE_GO_PROVIDER, 'future-model')
    expect(unknown).toEqual({ provider: OPENCODE_GO_PROVIDER, id: 'future-model', name: 'future-model', inputModalities: ['text'] })
  })
})

describe('ListingClient', () => {
  it('解析标准目录并按 key 缓存（mock 网关，不触真网关）', async () => {
    const gateway = await startMockGateway()
    try {
      const resolved = resolveConfig({ listingBaseURL: gateway.url })
      const client = new ListingClient(resolved)
      const first = await client.fetchIds('k1', new AbortController().signal)
      expect(first).toEqual(['deepseek-v4.1-flash', 'glm-5.3-flash'])
      expect(client.cachedIds('k1')).toEqual(first)
      expect(client.cachedIds('other')).toBeUndefined()
      expect(client.isStale('k1')).toBe(false)
    } finally {
      await gateway.close()
    }
  })

  it('parseListing 对畸形响应回答空列表', () => {
    expect(parseListing({ object: 'list', data: [{ id: 'a' }, 'junk', { noId: true }] })).toEqual(['a'])
    expect(parseListing(null)).toEqual([])
    expect(parseListing({ data: 'not-an-array' })).toEqual([])
  })
})
