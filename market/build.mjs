/**
 * 生成插件市场索引 / Build the plugin market index.
 *
 * 步骤 / Steps: 读 sources.txt 与 market.json → 调用 DSH 生成器写出 site/index.json → 合并市场元数据 →
 * 用格式校验器复核 → 覆盖写回。产物是纯静态目录，可直接部署。
 * Read sources.txt and market.json → run the DSH generator into site/index.json → merge market metadata →
 * re-validate with the format validator → write the result back. The output is a plain static directory.
 *
 * 用法 / Usage: node market/build.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runGenerator } from './lib/generator.mjs'
import { applyMarketMetadata, assertMarketConfig } from './lib/metadata.mjs'
import { MARKET_CONFIG_FILE, PUBLIC_INDEX_URL, SITE_DIR, SOURCES_FILE } from './lib/paths.mjs'
import { loadValidator, validateIndex } from './lib/validate.mjs'

/** 索引文件路径 / Path of the generated index. */
const INDEX_FILE = `${SITE_DIR}/index.json`

/**
 * 读取并解析 JSON 文件 / Read and parse a JSON file.
 * @param {string} path - 文件路径 / File path.
 * @returns {Promise<any>} 解析结果 / Parsed value.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * 源清单里的包名，忽略空行与 `#` 注释 / Package names from the source list, ignoring blanks and `#` comments.
 * @returns {Promise<string[]>} 包名列表 / Package names.
 */
async function readSources() {
  const text = await readFile(SOURCES_FILE, 'utf8')
  return text.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * 跑完整条流水线 / Run the whole pipeline.
 * @returns {Promise<void>} 写完校验通过的 index.json 后 resolve / Resolves after a validated index.json is written.
 */
async function main() {
  const sources = await readSources()
  if (sources.length === 0) throw new Error(`${SOURCES_FILE} 是空的 / is empty`)
  const config = await readJson(MARKET_CONFIG_FILE)
  assertMarketConfig(config)

  await mkdir(SITE_DIR, { recursive: true })
  console.log(`generating ${INDEX_FILE} from ${sources.length} source(s)`)
  await runGenerator({
    output: INDEX_FILE,
    title: config.title.en,
    onOutput: line => console.log(`  ${line}`),
  })

  const generated = await readJson(INDEX_FILE)
  const merged = applyMarketMetadata(generated, config)
  await loadValidator()
  validateIndex(merged)
  await mkdir(dirname(INDEX_FILE), { recursive: true })
  await writeFile(INDEX_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  console.log(`wrote ${INDEX_FILE}: ${merged.plugins.length} plugin(s), index URL ${PUBLIC_INDEX_URL}`)
}

await main()
