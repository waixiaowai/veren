// 页面级 runtime skill 的装载：renhua（人话写作技能）。skill 正文与元数据
// 仍在包内 skills/renhua/SKILL.md（人类可读、可单独维护）；本模块把它解析成
// 结构化声明——注册动作归页面组件体（agent.ctx.skills.register 直登，随
// agent fiber 生灭），这里只读文件、不注册。
// The page-scope runtime skill loader: renhua (the plain-Chinese writing
// skill). The body and metadata still live in the packaged
// skills/renhua/SKILL.md (human-readable, independently maintainable); this
// module parses it into a structured declaration — registration belongs to the
// page bodies (agent.ctx.skills.register, living and dying with the agent
// fiber); this module only reads the file, it never registers.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 包内 skills/ 目录（打包形态：dist/skills.js 的上一级）。The packaged skills/ directory (the parent of dist/skills.js in the packed shape). */
const SKILL_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

/**
 * 解析 SKILL.md 的 frontmatter（`---` 包围的 `key: value` 行，只认 name /
 * description / whenToUse 三个键）并剥出 Markdown 正文。字段缺失或正文为空
 * 一律抛错：技能声明是页面对模型的承诺，缺字段就是 broken，fail loud。
 * Parse a SKILL.md's frontmatter (the `---`-wrapped `key: value` lines; only
 * name / description / whenToUse are recognized) and strip the Markdown body.
 * A missing field or an empty body throws: a skill declaration is a promise to
 * the model, so a missing field is broken — fail loud.
 * @param source - SKILL.md 原文。The raw SKILL.md text.
 * @returns name/description/whenToUse 与正文。The fields plus the body.
 */
export function parseSkillFile(source: string): { name: string; description: string; whenToUse?: string; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (match === null) throw new Error('skill file has no frontmatter block')
  const fields = new Map<string, string>()
  for (const line of match[1]?.split(/\r?\n/) ?? []) {
    const pair = /^(\w+):\s*(.+)$/.exec(line)
    if (pair !== undefined && pair !== null) fields.set(pair[1] ?? '', pair[2] ?? '')
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  const whenToUse = fields.get('whenToUse')
  const content = source.slice(match[0].length).trim()
  if (name === '' || description === '' || content === '') {
    throw new Error(`skill file "${name}" is missing name, description, or body`)
  }
  return { name, description, ...(whenToUse === undefined ? {} : { whenToUse }), content }
}

/** 单会话 skill 的结构声明（与宿主 ctx.skills.register 的运行时技能面对齐）
 * / the structured declaration of a single-session skill (aligned with the host ctx.skills.register runtime-skill face) */
export interface RenhuaSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly content: string
}

/**
 * 装载 renhua 技能为单会话 skill 声明。惰性缓存——同一进程只读一次，测试可 reset。
 * Load the renhua skill as a single-session skill declaration. A lazy cache
 * keeps it to one read per process (tests may reset it).
 */
let cached: RenhuaSkill | undefined
export function loadRenhuaSkill(): RenhuaSkill {
  cached ??= parseSkillFile(readFileSync(`${SKILL_DIR}renhua/SKILL.md`, 'utf8'))
  return cached
}
