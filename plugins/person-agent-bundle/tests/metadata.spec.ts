import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packages = [
  'person-agent-bundle',
  'person-agent-dynamic-context',
  'person-agent-preset',
  'person-agent-tool-session',
  'person-agent-tool-workspace',
]

// Read resources without loading plugin entries. / 只读资源，不加载插件入口。
function resource(name: string, path: string): string {
  return readFileSync(new URL(`../../${name}/${path}`, import.meta.url), 'utf8')
}

describe.each(packages)('%s display metadata / 展示元数据', (name) => {
  it('exports and publishes its icon and locales / 导出并发布图标及语言资源', () => {
    const manifest = JSON.parse(resource(name, 'package.json'))
    expect(manifest.icon).toBe('./icon.svg')
    expect(manifest.files).toContain('icon.svg')
    expect(manifest.files).toContain('locale/*.json')
    expect(manifest.exports['./package.json']).toBe('./package.json')
    expect(manifest.exports['./icon']).toBe('./icon.svg')
    expect(manifest.exports['./locale/*.json']).toBe('./locale/*.json')
  })

  it.each(['en', 'zh'])('provides %s title and description / 提供标题和说明', (language) => {
    const { meta } = JSON.parse(resource(name, `locale/${language}.json`))
    expect(meta.title.trim().length).toBeGreaterThan(0)
    expect(meta.description.trim().length).toBeGreaterThan(0)
    expect(Object.keys(meta).sort()).toEqual(['description', 'title'])
  })

  it('provides a self-contained SVG / 提供自包含 SVG', () => {
    const svg = resource(name, 'icon.svg')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 64 64"')
    expect(svg).toContain('</svg>')
    expect(svg).not.toMatch(/<script|<foreignObject|\bhref=/i)
    expect(Buffer.byteLength(svg)).toBeLessThan(256 * 1024)
  })
})
