/**
 * 浏览器半边：挂载 `opencodeGo` 远端命名空间，在设置 → 模型 页脚注册
 * 登录卡片，并以单一可观察对象驱动轮询。铁律六：往别人的 slot 注册必须经
 * `ctx.slots.inject`。可观察状态源与动作工厂在 `./source.ts`。
 *
 * The browser half: mounts the `opencodeGo` Remote namespace, registers the
 * sign-in card in the Models settings footer, and drives polling from one
 * observable. Iron law six: registering into someone else's slot must go
 * through `ctx.slots.inject`. The observable source and its action factories
 * live in `./source.ts`.
 *
 * @module @veren/opencode-go/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import { NS, en, zh, type OgKey } from './locales.ts'
import { OpencodeGoCard, type OgCardInjected } from './card.tsx'
import { opencodeGoRemote, type OgDescribe, type OgPoll, type OgRemoteResult } from './remote.ts'
import { createOgSource } from './source.ts'

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    /** OpenCode Go sign-in card copy. */
    'opencode-go': OgKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Sign-in gateway, mounted by this plugin's client apply. */
    opencodeGo: {
      describe(): Promise<OgRemoteResult<OgDescribe>>
      begin(request: { readonly method?: string }): Promise<OgRemoteResult<{ readonly status: string }>>
      beginAuto(): Promise<OgRemoteResult<{ readonly started: boolean; readonly timeoutMs?: number }>>
      poll(): Promise<OgRemoteResult<OgPoll>>
      answer(request: { readonly value: string }): Promise<OgRemoteResult<{ readonly answered: boolean }>>
      cancel(): Promise<OgRemoteResult<{ readonly cancelled: boolean }>>
      signOut(): Promise<OgRemoteResult<{ readonly signedOut: boolean }>>
    }
  }
}

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-opencode-go-card'

/** The card stylesheet, inlined by `scripts/bundle.mjs` from `card.css`. */
declare const __OG_CSS__: string

/**
 * Client services. `remote.opencodeGo` must NOT be declared here: this plugin
 * is the namespace's only mounter, so depending on it would make the loader
 * wait for a service that does not exist until apply runs.
 * 客户端服务依赖。`remote.opencodeGo` 绝不能写在这里：本插件是该命名空间唯一
 * 的挂载者，声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * Mount the Remote namespace, then start the card plugin that waits on it.
 * Disposal unwinds in reverse: card first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the card fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(opencodeGoRemote)
  const card = ctx.plugin(CardPlugin)
  return async () => {
    await card.dispose()
    await unmount()
  }
}

/** Install the card stylesheet once, replacing any previous activation's copy. */
function installCardStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = __OG_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'opencode-go:styles')
}

/** 卡片插件：等命名空间就绪，注册页脚 slot 与双语字典。 */
const CardPlugin = {
  name: 'opencode-go:card',
  inject: ['remote.opencodeGo', 'slots', 'locale'],
  /** @param ctx - card-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const api = ctx.remote.opencodeGo
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'opencode-go:dictionaries')
    installCardStyles(ctx)
    const og = createOgSource(api)
    const injected = (): OgCardInjected => ({
      hooks: { og: og.source },
      onStartAuto: () => og.startAuto(),
      onStart: (method) => og.start(method),
      onAttach: () => og.attach(),
      onAnswer: (value) => og.answer(value),
      onCancel: () => og.cancel(),
      onDismiss: () => og.dismiss(),
      onSignOut: () => og.signOut(),
      onTogglePaste: () => og.togglePaste(),
    })
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
      name: 'settings.models.footer',
      key: '@veren/opencode-go',
      id: 'opencode-go',
      order: 50,
      locale: NS,
      inject: injected,
    }, OpencodeGoCard))
  },
} as const
