/**
 * 用 DSH 自带的格式校验器验证索引 / Validate an index with the format validator DSH ships.
 * 复用 `@deepseek-ai/dsh-plugin-market-index`，不复制规则；校验器从 DSH 检出的构建产物动态导入。
 * Reuses `@deepseek-ai/dsh-plugin-market-index` instead of restating its rules; the validator is imported from the
 * DSH checkout's build output.
 */
import { pathToFileURL } from 'node:url'
import { PUBLIC_INDEX_URL, VALIDATOR } from './paths.mjs'

/** 缓存导入的校验函数，避免每次校验都重新加载 / Cache the imported validator across calls. */
let validator

/**
 * 校验索引，失败时抛出带 JSON 路径的错误 / Validate the index, throwing a JSON-path error on failure.
 * @param {unknown} index - 待校验的索引文档 / The index document under test.
 * @returns {void}
 */
export function validateIndex(index) {
  if (validator === undefined) {
    throw new Error('先调用 loadValidator() / call loadValidator() first')
  }
  validator(index, PUBLIC_INDEX_URL)
}

/**
 * 载入校验器 / Load the validator.
 * @returns {Promise<void>} 校验器可用时 resolve / Resolves once the validator is usable.
 */
export async function loadValidator() {
  const module = await import(pathToFileURL(VALIDATOR).href)
  validator = module.parseMarketIndex
  if (typeof validator !== 'function') throw new Error(`${VALIDATOR} 没有 parseMarketIndex 导出 / exports no parseMarketIndex`)
}
