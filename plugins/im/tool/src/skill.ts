/**
 * 内置 `im-collaboration` 技能提供者：一条面向模型的协作纪律技能——回复契约
 * （回合文本就是房间消息）、闸门语义（HELD 是指引不是错误：读新事实、改写或安静、
 * 绝不复读）、安静纪律（不回应是正当选择）与记忆礼仪（值得留的才 im_remember）。
 * The bundled `im-collaboration` skill provider: one model-facing skill carrying
 * the collaboration discipline — the reply contract (the turn text IS the room
 * message), gate semantics (HELD is guidance, not an error: read the new facts,
 * rewrite or stay quiet, never echo), quiet discipline (not answering is a
 * legitimate choice), and memory etiquette (only facts worth keeping go through
 * im_remember).
 *
 * @module @veren/im-tool/skill
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill'

/** 技能名（kebab-case 语法）。The skill name (kebab-case grammar). */
export const SKILL_NAME = 'im-collaboration'

/** 正文 asset 的加载地址。The body asset's load URL. */
const SKILL_BODY_URL = new URL('../assets/im-collaboration.md', import.meta.url)
const SKILL_PATH = fileURLToPath(SKILL_BODY_URL)
const INVOCATION = { modelInvocable: true, userInvocable: false } as const

/** 路由文字：写明该加载与不该加载的请求，留在目录 500 字符预算内。 */
const DESCRIPTION = 'Use whenever you are acting inside an IM room session: replying to messages, '
  + 'using the im_* tools (im_send, im_rooms, im_read, im_people, im_person_report, '
  + 'im_remember, im_recall), or deciding whether to respond at all. Carries the reply '
  + 'contract (your turn text is delivered to the room verbatim), HELD gate semantics '
  + '(held means rewrite or stay quiet — never repeat), and memory etiquette. Skip it '
  + 'for account administration without any room context.'

const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: 'im-collaboration-skill',
  source: 'bundled',
  path: SKILL_PATH,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: 'im-collaboration-skill',
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      path: SKILL_PATH,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/**
 * 在调用作用域注册技能提供者；返回值即注销器，随作用域卸载清理。
 * Registers the skill provider on the calling scope; the return value is the
 * disposer, cleaned up when the scope unloads.
 */
export function registerCollaborationSkill(ctx: Context): () => void {
  return ctx.skills.registerProvider(() => provider)
}
