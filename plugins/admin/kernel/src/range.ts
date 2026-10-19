/**
 * The subset of semver range matching the platform needs.
 *
 * Providers declare ranges such as `^1.0`, `~1.2`, `>=1.0.0 <2.0.0` or `*`; the
 * kernel admits a provider only when its range contains the contract version.
 * A malformed range fails loudly at registration rather than silently matching
 * nothing.
 *
 * 平台所需的 semver 范围匹配子集。provider 声明 `^1.0`、`~1.2`、
 * `>=1.0.0 <2.0.0` 或 `*` 等范围；内核只在范围包含契约版本时接纳该 provider。
 * 畸形范围在注册时显式失败，而不是静默地什么都不匹配。
 *
 * @module @veren/admin-kernel/range
 */

/** A parsed `major.minor.patch` triple. 解析后的 `major.minor.patch` 三元组。 */
interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/**
 * Parse a dotted version, defaulting missing minor/patch to zero.
 *
 * @param input - text such as `1`, `1.2` or `1.2.3` 形如 `1`、`1.2`、`1.2.3` 的文本
 * @returns the triple 三元组
 * @throws when the text is not a dotted numeric version 文本不是点分数字版本时抛出
 */
function parseVersion(input: string): Version {
  const parts = input.trim().replace(/^v/, '').split('.')
  if (parts.length === 0 || parts.length > 3) throw new Error(`invalid version ${JSON.stringify(input)}`)
  const numbers = parts.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`invalid version ${JSON.stringify(input)}`)
    return Number(part)
  })
  const [major = 0, minor = 0, patch = 0] = numbers
  return { major, minor, patch }
}

/**
 * Total order over versions.
 *
 * @param a - left version 左版本
 * @param b - right version 右版本
 * @returns negative, zero or positive like `Array.prototype.sort` 与 `sort` 同义的负/零/正
 */
function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/**
 * Test one comparator clause such as `^1.2`, `>=1.0.0` or `1.2.3`.
 *
 * @param version - the candidate version 候选版本
 * @param clause - one range clause 单个范围子句
 * @returns whether the clause admits the version 子句是否接纳该版本
 * @throws when the clause uses unsupported syntax 子句使用不支持的语法时抛出
 */
function matchesClause(version: Version, clause: string): boolean {
  if (clause === '*' || clause === 'x') return true
  const operator = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(clause)
  if (operator === null) throw new Error(`invalid range clause ${JSON.stringify(clause)}`)
  const kind = operator[1] ?? '='
  const bound = parseVersion(operator[2] as string)

  switch (kind) {
    case '>=':
      return compare(version, bound) >= 0
    case '<=':
      return compare(version, bound) <= 0
    case '>':
      return compare(version, bound) > 0
    case '<':
      return compare(version, bound) < 0
    case '=':
      return compare(version, bound) === 0
    case '^':
      return compare(version, bound) >= 0 && version.major === bound.major
    case '~':
      return compare(version, bound) >= 0
        && version.major === bound.major
        && version.minor === bound.minor
    default:
      throw new Error(`invalid range operator ${JSON.stringify(kind)}`)
  }
}

/**
 * Whether a version satisfies a range. `||` separates alternatives; whitespace
 * separates conjunctions.
 *
 * @param version - the candidate version 候选版本
 * @param range - the declared range 声明的范围
 * @returns whether the range admits the version 范围是否接纳该版本
 * @throws when the range is malformed 范围畸形时抛出
 */
export function satisfies(version: string, range: string): boolean {
  const candidate = parseVersion(version)
  const alternatives = range.split('||')
  if (alternatives.length === 0) throw new Error('empty contract range')
  return alternatives.some((alternative) => {
    const clauses = alternative.trim().split(/\s+/).filter((clause) => clause.length > 0)
    return clauses.length > 0 && clauses.every((clause) => matchesClause(candidate, clause))
  })
}
