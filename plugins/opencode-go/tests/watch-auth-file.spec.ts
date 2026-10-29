/**
 * auth.json 监听器的生命周期红绿：内容变化去抖触发、未变化不触发、超时
 * 自停、文件缺失时回退轮询也能捕捉新出现。
 * Lifecycle red/green for the auth.json watcher: debounced content-change
 * firing, no fire without change, self-stop on timeout, and the missing-file
 * polling fallback catching a newly created file.
 *
 * @module @veren/opencode-go/tests
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { watchAuthFile } from '../src/watch-auth-file.js'

const dir = mkdtempSync(join(tmpdir(), 'og-watch-'))

const until = async (pass: () => boolean, ms: number): Promise<void> => {
  const deadline = Date.now() + ms
  while (!pass()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('watchAuthFile', () => {
  it('内容变化去抖后触发一次；未变化不触发', async () => {
    const path = join(dir, 'a.json')
    writeFileSync(path, '{"v":1}')
    let fired = 0
    const w = watchAuthFile({ path, timeoutMs: 5_000, debounceMs: 100, onChange: () => { fired++ } })
    writeFileSync(path, '{"v":2}')
    await until(() => fired === 1, 3_000)
    writeFileSync(path, '{"v":2}') // 同内容写入不触发 / an identical write never fires
    await new Promise((r) => setTimeout(r, 400))
    expect(fired).toBe(1)
    w.stop()
  })

  it('超时自停：之后的变化不再触发', async () => {
    const path = join(dir, 'b.json')
    writeFileSync(path, '{"v":1}')
    let fired = 0
    const w = watchAuthFile({ path, timeoutMs: 400, debounceMs: 50, onChange: () => { fired++ } })
    await new Promise((r) => setTimeout(r, 600))
    writeFileSync(path, '{"v":9}')
    await new Promise((r) => setTimeout(r, 400))
    expect(fired).toBe(0)
    w.stop()
  })

  it('文件缺失时回退轮询：新建文件也能捕捉', async () => {
    const path = join(dir, 'c.json')
    let fired = 0
    const w = watchAuthFile({ path, timeoutMs: 5_000, debounceMs: 100, onChange: () => { fired++ } })
    writeFileSync(path, '{"v":1}')
    await until(() => fired >= 1, 5_000)
    w.stop()
  })
})
