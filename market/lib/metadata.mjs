/**
 * 把市场级元数据合并进生成器写出的索引 / Merge market-level metadata into the generated index.
 * 生成器只认识 registry 里的事实（标题、图标、版本、engines.dsh）；分类、标签、精选关键词由本仓库维护。
 * The generator only knows registry facts (display fields, icons, versions, engines.dsh); categories, labels, and
 * curated keywords are owned by this repository.
 */

/** 市场配置里允许出现的插件级字段 / Plugin-level keys the market configuration may set. */
const PLUGIN_KEYS = new Set(['category', 'labels', 'keywords'])

/**
 * 合并标题、描述、声明表与每个插件的元数据。
 * Merge the title, description, declaration maps, and per-plugin metadata.
 * @param {object} index - 生成器写出的索引 / The index the generator wrote.
 * @param {object} config - market.json 的内容 / Contents of market.json.
 * @returns {object} 合并后的新索引，不修改入参 / A new index; the input is not mutated.
 */
export function applyMarketMetadata(index, config) {
  const overrides = config.plugins ?? {}
  const names = new Set(index.plugins.map(plugin => plugin.name))
  for (const name of Object.keys(overrides)) {
    if (!names.has(name)) throw new Error(`market.json 声明了索引里没有的插件 / market.json names a plugin the index does not list: ${name}`)
  }
  return {
    ...index,
    title: config.title,
    ...config.description === undefined ? {} : { description: config.description },
    ...config.metadata === undefined ? {} : { metadata: config.metadata },
    plugins: index.plugins.map(plugin => withMetadata(plugin, overrides[plugin.name])),
  }
}

/**
 * 用一个插件的覆盖值重写它的 metadata 段 / Rewrite one plugin's metadata from its override.
 * @param {object} plugin - 索引里的插件条目 / One plugin entry.
 * @param {object|undefined} override - market.json 中该插件的配置 / Its configuration in market.json.
 * @returns {object} 新条目 / A new entry.
 */
function withMetadata(plugin, override) {
  if (override === undefined) return plugin
  for (const key of Object.keys(override)) {
    if (!PLUGIN_KEYS.has(key)) throw new Error(`${plugin.name}: 未知字段 / unknown market.json field ${JSON.stringify(key)}`)
  }
  const merged = { ...plugin.metadata, ...override }
  return { ...plugin, metadata: merged }
}

/**
 * 检查 market.json 自身的一致性，给出比格式校验更早、更可读的报错。
 * Check market.json on its own, with earlier and clearer failures than the format validator gives.
 * @param {object} config - market.json 的内容 / Contents of market.json.
 * @returns {void}
 */
export function assertMarketConfig(config) {
  if (config.title === undefined) throw new Error('market.json 缺少 title / market.json has no title')
  if (config.metadata?.sortKeys !== undefined) throw new Error('market.json 不需要 sortKeys / market.json must not declare sortKeys')
  for (const [name, override] of Object.entries(config.plugins ?? {})) {
    for (const key of Object.keys(override)) {
      if (!PLUGIN_KEYS.has(key)) throw new Error(`${name}: 未知字段 / unknown market.json field ${JSON.stringify(key)}`)
    }
  }
}
