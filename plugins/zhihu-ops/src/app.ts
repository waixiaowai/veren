/**
 * 应用定义：应用 id、显示名、入口页、工具前缀。
 *
 * 应用 id 与工具前缀是**契约**——它们进页面 URL、进任务 kind、进工具全名，
 * 因此一旦发布就不改。工具前缀显式写死（`zhihu_ops`），不靠推导。
 *
 * The application definition: the app id, the display name, the entry page,
 * and the tool prefix.
 *
 * The app id and the tool prefix are a **contract** — they appear in page
 * urls, in task kinds, and in full tool names, so they never change after
 * release. The tool prefix is written out rather than derived.
 *
 * @module @veren/zhihu-ops/app
 */
import type { AppId, ApplicationDefinition, PageKey } from '@veren/app-registry'

/** 应用 id（稳定，进 URL 与任务 kind）/ the stable app id */
export const APP_ID = 'zhihu-ops' as AppId

/** 工具名前缀（进工具全名）/ the tool-name prefix */
export const TOOL_PREFIX = 'zhihu_ops'

/** 入口页键 / the entry page key */
export const ENTRY_PAGE = 'overview' as PageKey

/**
 * 应用定义。
 * The application definition.
 */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: '知乎运营分析',
  description: '每日采集知乎账号数据，派生涨粉与内容表现，写出可执行的运营分析报告',
  entry: ENTRY_PAGE,
  toolPrefix: TOOL_PREFIX,
  instructions: [
    '这是知乎账号的运营分析工作面。数据来自知乎官方开放平台的只读采集：账号统计、每篇内容统计、评论、热榜与选题建议。',
    '正文里的数字是采集时刻的真身：采集按天幂等，同一天重采是覆盖而不是累加；报告是模型写的叙事，数字以采集账与页面数据为准。',
    '写动作只有两类：立即重采（refresh_now）与生成报告（generate_report）。它们都只写本地存储与报告，不会替你在知乎上发布任何内容。',
    '凭据没配时先走 setup_credentials 粘贴 Access Secret；没配凭据就说清楚，不要重试采集。',
  ].join(''),
}
