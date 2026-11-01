/**
 * 技能面提取：包内 skills/<dir>/SKILL.md 的 frontmatter 名（技能声明处）与加载器
 * 映射（组件体里 loadXxxSkill() → 技能文件）。单会话 skill 由组件体直登，声明
 * 与登记两侧各自可验。
 * Skill-face extraction: the frontmatter names of a package's skills/<dir>/SKILL.md
 * (the declaration sites) and the loader map (loadXxxSkill() in a body → its
 * skill file). Single-session skills register in the body; both sides are
 * independently verifiable.
 * @module scripts/lib/model-surface/skills
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import ts from 'typescript'

/** 从 SKILL.md frontmatter 取 name / read a SKILL.md frontmatter name */
function frontmatterName(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return undefined
  const line = match[1].split(/\r?\n/).find((row) => /^name:/.test(row))
  return line === undefined ? undefined : line.replace(/^name:\s*/, '').trim().replace(/^['"]|['"]$/g, '')
}

/**
 * 收集技能声明：每包 skills/ 目录下逐个 SKILL.md → 技能目录名 → frontmatter 名。
 * Collect skill declarations: each SKILL.md under a package's skills/ dir,
 * keyed by the skill directory with its frontmatter name.
 * @param {string} root - workspace root / 工作区根
 * @param {Iterable<string>} packages - plugin package names / 插件包名
 * @returns {Promise<Map<string, { name: string, pkg: string, file: string }>>} dir → declaration
 */
export async function collectSkillDeclarations(root, packages) {
  const declarations = new Map()
  for (const pkg of packages) {
    const skillsDir = join(root, 'plugins', pkg, 'skills')
    let entries
    try {
      entries = await readdir(skillsDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const file = join(skillsDir, entry.name, 'SKILL.md')
      const name = frontmatterName(await readFile(file, 'utf8').catch(() => ''))
      if (name !== undefined && name !== '') declarations.set(entry.name, { name, pkg, file })
    }
  }
  return declarations
}

/**
 * 收集技能加载器：函数体内 readFileSync 的模板含 SKILL.md → 函数名 → 技能目录
 * 名（取模板最后一段静态文本里的目录段）。
 * Collect skill loaders: a function whose readFileSync template names SKILL.md
 * → function name → the skill directory (the directory segment of the
 * template's last static segment).
 * @param {import('./world.mjs').World} world - extraction world / 提取世界
 * @returns {Map<string, { pkg: string, dir: string }>} loader fn name → skill dir
 */
export function collectSkillLoaders(world) {
  const loaders = new Map()
  for (const [path, unit] of world.units) {
    for (const [name, node] of unit.declarations) {
      const dir = skillDirOf(node)
      if (dir !== undefined) loaders.set(name, { pkg: pkgOf(path, world), dir })
    }
  }
  return loaders
}

/** 提取一个声明节点里的技能目录 / extract the skill directory from a declaration node */
function skillDirOf(node) {
  const body = ts.isFunctionDeclaration(node) ? node.body : node.initializer
  if (body === undefined) return undefined
  let found
  const visit = (current) => {
    if (found !== undefined) return
    if (ts.isTemplateExpression(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      const text = ts.isTemplateExpression(current)
        ? current.head.text + current.templateSpans.map((span) => span.literal.text).join('')
        : current.text
      if (text.includes('SKILL.md')) {
        found = text.split('SKILL.md')[0].replace(/\/+$/, '').split('/').pop()
        return
      }
    }
    current.forEachChild(visit)
  }
  visit(body)
  return found
}

/** 一个文件路径所属的插件包名 / the plugin package owning a file path */
function pkgOf(path, world) {
  const normalized = path.replaceAll('\\', '/')
  for (const pkg of world.packages) {
    if (normalized.includes(`/plugins/${pkg}/`)) return pkg
  }
  return dirname(path).split(/[/\\]/).pop() ?? ''
}
