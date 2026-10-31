/**
 * G13 全成或全回滚：接线一步失败，系统回到"什么也没接"——装配回滚语义的验收。
 * G13 all-or-nothing: one wiring step fails and the system returns to "nothing
 * wired" — acceptance for the assembly's rollback semantics.
 * @module tests/assembly-rollback.spec
 */
import { describe, expect, it } from 'vitest'
import { createElement } from '@veren/prompt-core'
import type { AppId } from '@veren/app-registry'
import type { PageInstanceKey } from '@veren/prompt-page'
import { wireAppHost } from '../src/index.ts'
import { boot, registerMiniApp } from './app-host.harness.ts'

describe('G13 全成或全回滚：接线一步失败，系统回到"什么也没接"', () => {
  it('镜像面抛错 → resolver 被回滚、端口未绑定、镜像面不在场', async () => {
    // enabled:false：装配层不自动接线，本用例手工触发一次会失败的装配
    const h = await boot({ enabled: false })
    registerMiniApp(h)
    const warnings: string[] = []
    const original = h.ctx.logger.warn
    ;(h.ctx.logger as { warn: (m: string) => void }).warn = (m: string) => { warnings.push(m) }
    // 注入一个会失败的镜像面（装配第 2 步抛错）
    const apps = h.ctx.apps as { setPageMirror: (mirror: unknown) => void }
    apps.setPageMirror = () => { throw new Error('mirror boom') }
    try {
      expect(() => wireAppHost(h.ctx)).toThrow('mirror boom')
      // resolver 已回滚：未注册应用的 send 不被拒（resolver 在场时会 task/send-forbidden）
      await expect(h.tasks.send({
        kind: 'mini/kind' as never, title: 't',
        target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'ghost', page: 'task', params: {} },
      })).resolves.toBeDefined()
      // 端口未绑定：openUrl 给 page/host-unavailable（装配第 3 步从未执行）
      await expect(h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey))
        .rejects.toMatchObject({ code: 'page/host-unavailable' })
      // 镜像面不在场：注册页面只告警，不镜像进 page-registry
      h.ctx.apps.pages('mini' as AppId, h.ctx).register(
        () => createElement('p', { children: 'solo' }),
        { url: '/apps/mini/solo', description: 'd' },
      )
      expect(warnings.some((m) => m.includes('no page mirror wired'))).toBe(true)
      expect(h.pages.resolve('/apps/mini/solo')).toBeNull()
    } finally {
      ;(h.ctx.logger as { warn: (m: string) => void }).warn = original
    }
  })
})
