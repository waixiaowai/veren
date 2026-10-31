/**
 * 「Sub2API 运营」应用定义（单一事实源）：应用 id 与应用目录定义。工具目录
 * （tools.ts）与页面域（pages.tsx 及其拆分文件）都从这里取 APP_ID，不再各自
 * 声明常量副本。
 * The "Sub2API 运营" application definition (single source of truth): the app
 * id and the app-catalog definition. Both the tool catalog (tools.ts) and the
 * page domain (pages.tsx and its split files) take APP_ID from here instead of
 * declaring their own constant copies.
 *
 * @module @veren/sub2api-admin/app-definition
 */
import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'

/** 应用 id（页面 URL 前缀与工具前缀的权威来源）/ the app id (authority of the url prefix and the tool prefix) */
export const APP_ID = 'sub2api-admin' as AppId

/** 应用定义：entry 是应用内页面键 / the definition; entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: 'Sub2API 运营',
  description: 'Sub2API 运营指挥台：经营指标、渠道/分组/用户/订阅/资金/卡密/账号/用量全流程管理',
  entry: 'home' as PageKey,
  instructions: 'Sub2API 运营应用覆盖运营全流程：home 是指挥台（经营指标+待办+操作指引），'
    + 'channels 渠道、groups 分组与倍率、users 用户与余额、subscriptions 订阅、finance 订单与套餐、'
    + 'codes 兑换码与优惠码、accounts 上游账号、usage 用量分析。'
    + '页面数据由 sub2api_admin__* 工具读写，正文是打开时刻的首屏——此后的变化以工具返回的结果为准。'
    + '读写与常规运营写（L1）自主执行，完成后用一句话点名产物（id/字段前后值）回报；'
    + '真破坏性动作（退款/删套餐/删码，L2）在本回合没有人类消息时会被工具以 unattended/l2-refused 拒绝——'
    + '此时不要重试，改走可逆替代或如实转述用户。',
  toolPrefix: 'sub2api_admin',
}
