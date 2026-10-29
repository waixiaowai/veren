/**
 * 内置 `image-generation` 技能提供者：一条面向模型的技能，把生料 SKILL.md
 * 的决策纪律带进 DSH——生成/编辑的意图判定、用途分类、结构化 prompt schema、
 * 按具体度分级的增补政策、raster-vs-vector 门槛与迭代纪律。Codex 专属壳
 * （内置 image_gen 工具、$CODEX_HOME、view_image、CLI 回退）一律不移植。
 * The bundled `image-generation` skill provider: one model-facing skill that
 * carries the raw material's decision discipline into dsh — the generate/edit
 * intent split, the use-case taxonomy, the structured prompt schema, the
 * specificity-graded augmentation policy, the raster-vs-vector gate, and the
 * iteration discipline. Codex-specific shells (the built-in image_gen tool,
 * $CODEX_HOME, view_image, the CLI fallback) are never ported.
 *
 * @module @veren/imagegen
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill'

/** 技能名（kebab-case 语法）。The skill name (kebab-case grammar). */
export const SKILL_NAME = 'image-generation'

/** 正文 asset 的加载地址；references/ 相对它解析（resourceBase 语义）。 */
/** The body asset's load URL; references/ resolve against it (the resourceBase semantics). */
const SKILL_BODY_URL = new URL('../assets/image-generation.md', import.meta.url)
const SKILL_PATH = fileURLToPath(SKILL_BODY_URL)
/** 正文与 references/ 所在目录（渐进披露的取材根）。The directory holding the body and references/ (the progressive-disclosure resource root). */
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('../assets/', import.meta.url)) } as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/**
 * 路由文字：写明该加载与不该加载的请求，留在目录 500 字符预算内。
 * Routing text: names both the requests that should load this skill and the
 * ones that should not, inside the catalog's 500-character budget.
 */
const DESCRIPTION = 'Use when the user asks for a generated or AI-edited raster image — photos, illustrations, sprites, mockups, textures, transparent cutouts, or image variants — via the imagegen tools. Carries the prompting discipline: generate-vs-edit intent, the use-case taxonomy, the structured prompt schema, augmentation policy, and single-change iteration. Skip it for SVG/vector/icon work, diagrams better served by HTML/CSS/canvas, or editing existing repo-native assets.'

const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: 'imagegen-skill',
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  path: SKILL_PATH,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: 'imagegen-skill',
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
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
export function registerImagegenSkill(ctx: Context): () => void {
  return ctx.skills.registerProvider(() => provider)
}
