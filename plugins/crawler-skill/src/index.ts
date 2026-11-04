/**
 * Bundled `crawler` skill provider: one model-invocable skill that teaches
 * when collecting public content is the right request, how the five
 * `crawler__` tools behave, the single-task mutex, the save media, the login
 * requirement, and failure handling.
 *
 * Immutable, zero configuration: it registers one fixed candidate at the
 * bundled skill rank and reads the body from the packaged asset on every
 * load. Kept in its own row so a profile without the `skills` service only
 * leaves this row pending and never takes down the crawler row.
 *
 * 内置 `crawler` 技能提供者：一条面向模型的技能，讲清什么时候该采公开
 * 内容、五个 `crawler__` 工具的行为、单任务互斥、保存介质、登录要求与
 * 失败处理。
 *
 * 提供者不可变、零配置：在 bundled rank 注册唯一候选，每次加载从包内
 * asset 读正文。独立成行后，没有 `skills` 服务的 profile 只会让本行
 * pending，绝不会拖垮 crawler 行。
 *
 * @module @veren/crawler-skill
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'

/** Plugin name registered with the Loader. / 注册到 Loader 的插件名。 */
export const name = 'crawler-skill'

/** Empty configuration: mounting the row is the only switch. / 空配置：挂载这一行就是唯一开关。 */
export const Config = z.object({})

/** The skills service keeps this row pending when absent. / 没有 skills 服务时本行保持 pending。 */
export const inject = ['skills']

const PROVIDER_NAME = 'crawler-skill'
const SKILL_NAME = 'crawler'
const SKILL_PATH = fileURLToPath(new URL('../assets/crawler.md', import.meta.url))
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/**
 * Routing text the session skill catalog shows the model; names both the
 * load cases and the skip cases inside the 500-character budget.
 * 会话技能目录展示给模型的路由文字；在 500 字符预算内同时写明加载与
 * 跳过的情形。
 */
const DESCRIPTION = 'Use when the user asks to collect public contents or comments from Chinese content communities (xhs/dy/ks/bili/wb/tieba/zhihu) — keyword search, content detail, or creator mode — or asks about crawl task status, collected data, or a failed crawl; covers the crawler__ tools, the single-task mutex, the save media, the login requirement, and rate-limit etiquette. Skip it for posting, commenting, or any interaction on those platforms — the crawler is strictly read-only.'

const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  path: SKILL_PATH,
  rank: BUNDLED_SKILL_RANK,
  locator: new URL('../assets/crawler.md', import.meta.url),
}

/** The one fixed candidate. / 唯一的固定候选。 */
const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition | undefined> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      content: await readFile(SKILL_PATH, 'utf8'),
    }
  },
}

/**
 * 装配：注册技能提供者（宿主以工厂形式接管生命周期），卸载即注销。
 * Assembles: registers the skill provider (the host owns the lifecycle via
 * the factory form), disposed on unload.
 */
export const apply = (ctx: Context): void => {
  ctx.effect(() => ctx.skills.registerProvider(() => provider), 'crawler-skill:provider')
}
