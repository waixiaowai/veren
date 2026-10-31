/**
 * 浏览器半边：挂载 `workbuddyAuth` 远端命名空间，在设置 → 模型 页脚注册
 * 登录/账号卡片。铁律六：往别人的 slot 注册必须经 `ctx.slots.inject`；
 * `remote.workbuddyAuth` 绝不能出现在 inject 里（本插件是该命名空间唯一
 * 挂载者，声明依赖会让 loader 等一个 apply 前不存在的服务）。
 * The browser half: mounts the `workbuddyAuth` Remote namespace and registers
 * the sign-in/account card in the Models settings footer. Iron law six:
 * registering into someone else's slot goes through `ctx.slots.inject`;
 * `remote.workbuddyAuth` must NOT appear in inject (this plugin is the
 * namespace's only mounter — declaring it would stall the loader on a service
 * that does not exist until apply runs).
 *
 * @module @veren/workbuddy-auth/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import { NS, en, zh, type WbKey } from './locales.ts'
import { WorkbuddyCard, type WbCardInjected } from './card.tsx'
import { workbuddyAuthRemote, type WbCredits, type WbDescribe, type WbPoll, type WbProbeOutcome } from './remote.ts'
import { createWbSource } from './wb-source.ts'

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    /** WorkBuddy sign-in card copy. */
    'workbuddy-auth': WbKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Sign-in gateway, mounted by this plugin's client apply. */
    workbuddyAuth: {
      describe(): Promise<{ ok: true; value: WbDescribe } | { ok: false; error: { message: string; code?: string } }>
      begin(request: { readonly method?: string }): Promise<{ ok: true; value: { started: boolean; reason?: string } } | { ok: false; error: { message: string; code?: string } }>
      poll(): Promise<{ ok: true; value: WbPoll } | { ok: false; error: { message: string; code?: string } }>
      cancel(): Promise<{ ok: true; value: { cancelled: boolean } } | { ok: false; error: { message: string; code?: string } }>
      signOut(request: { readonly uid: string }): Promise<{ ok: true; value: { signedOut: boolean } } | { ok: false; error: { message: string; code?: string } }>
      toggle(request: { readonly uid: string; readonly disabled: boolean }): Promise<{ ok: true; value: { disabled: boolean } } | { ok: false; error: { message: string; code?: string } }>
      credits(request: { readonly uid: string }): Promise<{ ok: true; value: WbCredits } | { ok: false; error: { message: string; code?: string } }>
      probe(request: { readonly uid: string; readonly model: string }): Promise<{ ok: true; value: WbProbeOutcome } | { ok: false; error: { message: string; code?: string } }>
    }
  }
}

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-workbuddy-auth-card'

/** The card stylesheet, inlined by `scripts/bundle.mjs` from `card.css`. */
declare const __WB_CSS__: string

/** 客户端服务依赖（`remote.workbuddyAuth` 刻意缺席，见文件头）。 */
/** Client service deps (`remote.workbuddyAuth` deliberately absent — see the header). */
export const inject = ['slots', 'locale', 'remote']

/** 挂载命名空间，再起等它的卡片插件；卸载逆序：先卡片后命名空间。 */
/** Mounts the namespace, then starts the card plugin that waits on it; disposal unwinds card first, namespace last. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(workbuddyAuthRemote)
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
    style.textContent = __WB_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'workbuddy-auth:styles')
}

/** 卡片插件：等命名空间就绪，注册页脚 slot 与双语字典。 */
/** The card plugin: waits on the namespace, registers the footer slot and the bilingual dictionary. */
const CardPlugin = {
  name: 'workbuddy-auth:card',
  inject: ['remote.workbuddyAuth', 'slots', 'locale'],
  apply(ctx: Context): void {
    const api = ctx.remote.workbuddyAuth
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workbuddy-auth:dictionaries')
    installCardStyles(ctx)
    const wb = createWbSource(api)
    const injected = (): WbCardInjected => ({
      hooks: { wb: wb.source },
      onStart: (method) => wb.start(method),
      onAttach: () => wb.attach(),
      onCancel: () => wb.cancel(),
      onDismiss: () => wb.dismiss(),
      onSignOut: (uid) => wb.signOut(uid),
      onToggle: (uid, disabled) => wb.toggle(uid, disabled),
      onCredits: (uid) => wb.credits(uid),
      onProbe: (uid, model) => wb.probe(uid, model),
    })
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
      name: 'settings.models.footer',
      key: '@veren/workbuddy-auth',
      id: 'workbuddy-auth',
      order: 51,
      locale: NS,
      inject: injected,
    }, WorkbuddyCard))
  },
} as const
