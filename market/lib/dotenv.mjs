/**
 * 仓库根 `.env` 的极简加载器 / Minimal loader for the repository-root `.env`.
 * `.env` 已被 .gitignore 的 `*.env` 规则排除，永远不入库；这里只认 `KEY=VALUE`
 * 行，`#` 注释与空行跳过，成对引号剥掉。已存在的环境变量优先——文件不覆盖它们，
 * 因此 CI 或临时覆盖仍然生效。
 *
 * The root `.env` is excluded by the `*.env` rule in .gitignore and never enters
 * the repository. Only `KEY=VALUE` lines are recognized; `#` comments and blank
 * lines are skipped and paired quotes are stripped. Variables already present in
 * the environment win — the file never overrides them, so CI or ad-hoc overrides
 * keep working.
 *
 * @module @veren/market/dotenv
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT_DIR } from './paths.mjs'

/**
 * 把 `.env` 里尚未设置过的键注入 process.env / Inject `.env` keys not already set.
 *
 * @returns {string[]} 实际注入的键名 / The keys actually injected.
 */
export function loadDotEnv() {
  const file = resolve(ROOT_DIR, '.env')
  if (!existsSync(file)) return []
  const injected = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (text === '' || text.startsWith('#')) continue
    const equals = text.indexOf('=')
    if (equals <= 0) continue
    const key = text.slice(0, equals).trim()
    let value = text.slice(equals + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key in process.env) continue
    process.env[key] = value
    injected.push(key)
  }
  return injected
}
