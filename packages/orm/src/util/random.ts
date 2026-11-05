/**
 * 跨平台随机 UUID：优先用 Web Crypto（Node 19+、浏览器、Workers 都有），
 * 缺失时回退到 Math.random 版本——仅用于开发环境，不用于安全标识。
 *
 * Cross-platform random UUID: prefer Web Crypto (available on Node 19+,
 * browsers and Workers); fall back to a Math.random variant for development
 * only, never for security-sensitive identifiers.
 *
 * @module @veren/orm/util/random
 */

/** 生成 UUID v4。 / Generate a UUID v4. */
export function randomUuid(): string {
  const source = globalThis.crypto
  if (source !== undefined && typeof source.randomUUID === 'function') return source.randomUUID()
  return fallbackUuid()
}

/** 无 crypto 时的回退实现。 / Fallback when crypto is unavailable. */
function fallbackUuid(): string {
  const hex = '0123456789abcdef'
  let value = ''
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) value += '-'
    else if (index === 14) value += '4'
    else if (index === 19) value += hex[(Math.random() * 4 | 0) + 8]
    else value += hex[Math.random() * 16 | 0]
  }
  return value
}
