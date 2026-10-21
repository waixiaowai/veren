/**
 * 极小的 semver 区间判定：只覆盖工作区发布产生的 `^x.y.z` / `~x.y.z` / 精确版本，
 * 用来确认"发布出来的清单里每个第一方依赖都能在 registry 上找到满足它的版本"。
 * 超出这三种写法的区间返回 undefined，由调用方决定怎么处理。
 *
 * Tiny semver-range test: covers only the `^x.y.z` / `~x.y.z` / exact forms that
 * workspace publishing produces, so a released manifest's first-party
 * dependencies can be checked against the versions the registry actually holds.
 * Returns undefined for any other range syntax; the caller decides what to do.
 *
 * @module @veren/market/semver
 */

/**
 * 候选版本是否满足区间 / whether a candidate version satisfies the range.
 *
 * @param {string} version - candidate version / 候选版本
 * @param {string} range - declared range / 声明的区间
 * @returns {boolean | undefined} result, or undefined when the syntax is unsupported / 结果；语法不支持时为 undefined
 */
export function satisfies(version, range) {
  const text = range.trim()
  const operator = text.startsWith('^') ? '^' : text.startsWith('~') ? '~' : '='
  const target = parse(operator === '=' ? text : text.slice(1))
  const candidate = parse(version)
  if (target === undefined || candidate === undefined) return undefined
  if (operator === '=') return same(candidate, target)
  if (compare(candidate, target) < 0) return false
  const [major, minor] = target
  if (operator === '~') return candidate[0] === major && candidate[1] === minor
  // caret：主版本非零时放宽到同一主版本；0.x 收窄到同一次版本；0.0.x 只认精确版本。
  // caret: a non-zero major spans the major; 0.x spans the minor; 0.0.x is exact.
  if (major > 0) return candidate[0] === major
  if (minor > 0) return candidate[0] === 0 && candidate[1] === minor
  return same(candidate, target)
}

/**
 * `x.y.z[-pre]` 解析成数字三元组 / parse `x.y.z[-pre]` into a numeric triple.
 *
 * @param {string} text - version text / 版本文本
 * @returns {number[] | undefined} `[major, minor, patch]`, or undefined / 三元组或 undefined
 */
function parse(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(text)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * 按 major/minor/patch 依次比较 / compare two triples major, minor, patch.
 *
 * @param {number[]} left - first triple / 左三元组
 * @param {number[]} right - second triple / 右三元组
 * @returns {number} negative, zero or positive / 负数、零或正数
 */
function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

/**
 * 三个数字全等 / all three numbers equal.
 *
 * @param {number[]} left - first triple / 左三元组
 * @param {number[]} right - second triple / 右三元组
 * @returns {boolean} equality / 是否相等
 */
function same(left, right) {
  return compare(left, right) === 0
}
