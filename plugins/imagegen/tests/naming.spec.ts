/** 非破坏性命名：重名派生 -v2 兄弟名，永不覆盖。 */
/** Non-destructive naming: collisions derive -v2 siblings; nothing is ever overwritten. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { avoidCollision } from '../src/naming.js'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function scratch(): string {
  dir = mkdtempSync(join(tmpdir(), 'imagegen-naming-'))
  return dir
}

describe('avoidCollision', () => {
  it('returns the requested path when free', () => {
    const base = scratch()
    expect(avoidCollision(join(base, 'hero.png'))).toBe(join(base, 'hero.png'))
  })

  it('derives -v2 then -v3 siblings on collisions', () => {
    const base = scratch()
    writeFileSync(join(base, 'hero.png'), 'x')
    expect(avoidCollision(join(base, 'hero.png'))).toBe(join(base, 'hero-v2.png'))
    writeFileSync(join(base, 'hero-v2.png'), 'x')
    expect(avoidCollision(join(base, 'hero.png'))).toBe(join(base, 'hero-v3.png'))
  })

  it('keeps the extension on versioned siblings', () => {
    const base = scratch()
    writeFileSync(join(base, 'sprite.webp'), 'x')
    expect(avoidCollision(join(base, 'sprite.webp'))).toBe(join(base, 'sprite-v2.webp'))
  })
})
