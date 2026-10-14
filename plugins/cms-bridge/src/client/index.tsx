/**
 * cms-bridge Web UI 客户端入口(React + TSX + CSS Module)。
 * The cms-bridge Web UI client entry (React + TSX + CSS Module).
 *
 * 模块契约(与 dsh 编译产物一致):导出 inject(服务级激活顺序)与 apply;
 * apply 世界负责 locale 注册、状态 store 生命周期与 slot 注册(铁律 1/6);
 * 组件只经 props 接收数据与行为(铁律 10)。
 * Module contract (same as dsh-built artifacts): exports inject (the
 * service-level activation order) and apply; the apply world owns locale
 * registration, the status store lifecycle and slot registration (rules 1/6);
 * components receive data and behavior purely via props (rule 10).
 */
import type { Context } from '@deepseek-ai/cordis';
// 类型-only:只为拉取 slots/locale 等 Service 的 declaration merge(使 ctx.slots 可用)
// Type-only: pulls the declaration merges for slots/locale etc. (makes ctx.slots usable).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { createStatusStore } from './bridge.ts';
import { rotateCredential } from './bridge.ts';
import { CmsBridgePanel } from './CmsBridgePanel.tsx';
import { NS, en, zh } from './i18n.ts';
import type { Translate } from './i18n.ts';

/** 服务级注入:slots(挂载点)与 locale(多语言)/ service-level inject: slots (mount) and locale (i18n) */
export const inject = ['slots', 'locale'];

export function apply(ctx: Context): void {
    // 多语言:zh/en 字典注册随 fiber 卸载清理(推荐写法 5)
    // Locale: the zh/en dict registration cleans up with the fiber (rule 5).
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cms-bridge/locale');
    // 绑定 NS 后的 t 跟随用户语言偏好切换(主题/语言均由宿主服务托管)
    // The bound t follows the user's locale preference (theme/locale are owned by host services).
    const t = ctx.locale.bind(NS) as unknown as Translate;

    // 状态 store:轮询生命周期归 apply 世界,组件只拿快照(铁律 9)
    // The status store: polling lifecycle belongs to the apply world; the
    // component only sees snapshots (rule 9).
    const store = createStatusStore();
    ctx.effect(() => {
        store.start();
        return () => { store.stop(); };
    }, 'cms-bridge/status-store');

    // 换凭证行为留在 apply 世界,经 props 穿给表单(铁律 10)
    // The rotate behavior stays in the apply world and reaches the form via props.
    const rotate = (token: string): Promise<void> => rotateCredential(token);

    // 铁律一:往别人的 slot 注册,必须经 ctx.slots.inject(规则 6)
    // Rule 1: registering into an owned slot goes through ctx.slots.inject.
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: '@veren/cms-bridge',
    }, () => <CmsBridgePanel store={store} rotate={rotate} t={t} />));
}
