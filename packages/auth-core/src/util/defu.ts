/**
 * defu 形默认值深合并：已存在的值优先，补丁只填缺省（设计文档
 * modules/01-context.md §1.4 Plugin Merge Chain）。
 * 数组整体替换不合并；普通对象递归；其余值先到先得。
 *
 * The defu-style defaults-deep-merge: existing values win, patches only fill
 * gaps (design modules/01-context.md §1.4 Plugin Merge Chain). Arrays replace
 * wholesale; plain objects recurse; everything else is first-write-wins.
 *
 * @module @veren/auth-core/util/defu
 */

/** 是否为普通对象（非数组、非 null）。 / Whether the value is a plain object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 source 的缺省键补进 target（就地返回新对象）。 / Fill target's missing keys from source (returns a fresh object). */
export function defu<T extends object>(target: T, source: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...(target as Record<string, unknown>) }
  for (const [key, value] of Object.entries(source)) {
    const current = merged[key]
    if (current === undefined) {
      merged[key] = value
      continue
    }
    if (isPlainObject(current) && isPlainObject(value)) merged[key] = defu(current, value)
  }
  return merged as T
}
