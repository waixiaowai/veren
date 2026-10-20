/**
 * The SPA carrier's promise: the files `CLIENT_ROOT` points at must exist and be
 * servable through the containment rules.
 *
 * SPA 载体的承诺：`CLIENT_ROOT` 指向的文件必须存在，并且能通过路径收敛规则被提供。
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentTypeFor, resolveWithin } from '../src/static.ts'

/** The same client root the plugin resolves at runtime. 插件运行时解析的同一客户端根目录。 */
const CLIENT_ROOT = fileURLToPath(new URL('../client/', import.meta.url))

describe('SPA assets', () => {
  it('ships the shell and the modules it loads', () => {
    for (const file of ['/index.html', '/app.js', '/api.js', '/runtime.js', '/views.js', '/styles.css', '/scheme-boot.js']) {
      const path = resolveWithin(CLIENT_ROOT, file)
      expect(path, `${file} must resolve inside the client root`).toBe(resolve(CLIENT_ROOT, file.slice(1)))
      expect(existsSync(path as string), `${file} must exist`).toBe(true)
    }
  })

  it('types the shell as HTML and the modules as JavaScript', () => {
    expect(contentTypeFor(resolve(CLIENT_ROOT, 'index.html'))).toContain('text/html')
    expect(contentTypeFor(resolve(CLIENT_ROOT, 'app.js'))).toContain('text/javascript')
    expect(contentTypeFor(resolve(CLIENT_ROOT, 'styles.css'))).toContain('text/css')
  })

  it('loads the shell only same-origin assets', () => {
    const html = fileURLToPath(new URL('../client/index.html', import.meta.url))
    expect(existsSync(html)).toBe(true)
  })
})
