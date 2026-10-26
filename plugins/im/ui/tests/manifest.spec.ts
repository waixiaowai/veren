/**
 * Bundle metadata specs for the im-ui package.
 *
 * The most expensive mistake a client package can make is shipping without its
 * browser half or without the `dsh.client` declaration: the install reports
 * success while the sidebar entry never appears. These specs pin the manifest's
 * two halves, the locale dictionaries' key parity, and the namespace/method
 * wiring of the hand-built Remote contribution.
 *
 * im-ui 包的元数据测试。
 *
 * 客户端包代价最高的错误是「浏览器半边缺失或未声明 `dsh.client`」：安装报告成功而侧栏入口
 * 永远不出现。这些测试钉住清单的两个半边、双语字典的键对齐，以及手工 Remote contribution
 * 的命名空间与方法接线。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('im-ui manifest', () => {
  it('declares the web client platform with its module injects', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { client?: { platform?: string; inject?: readonly string[] } }
      main?: string
    }
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject?.length ?? 0).toBeGreaterThan(0)
    expect(manifest.main).toBe('./dist/index.js')
  })

  it('ships both halves in the files whitelist', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      files?: readonly string[]
      exports?: Record<string, unknown>
    }
    expect(manifest.files).toContain('lib/client.js')
    expect(manifest.exports?.['./client']).toBeDefined()
  })
})

describe('im-ui locale dictionaries', () => {
  it('keep zh and en key parity with the typed key set', async () => {
    const { NS, en, zh } = await import('../src/client/locales.ts')
    expect(NS).toBe('im')
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})

describe('im-ui remote contribution', () => {
  it('wires every method to the imGateway service under the im namespace', async () => {
    const { imRemote } = await import('../src/client/remote.ts')
    const methods = (imRemote as { methods: Record<string, { service: string }> }).methods
    const names = Object.keys(methods).sort()
    expect(names).toEqual([
      'im/beginBind', 'im/catalog', 'im/intakeStatus', 'im/link', 'im/people',
      'im/pollBind', 'im/settings', 'im/submitBindCode', 'im/unbindAccount', 'im/unbindBinding',
    ])
    for (const name of names) expect(methods[name]!.service).toBe('imGateway')
  })
})
