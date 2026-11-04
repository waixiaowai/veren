/**
 * 应用定义：应用 id、显示名、入口页与工具前缀（意见 5：dsh client 入口）。
 * The application definition: the app id, the display name, the entry page,
 * and the tool prefix (directive 5: the dsh client entry).
 *
 * 应用 id 与工具前缀是**契约**——它们进页面 URL、进任务 kind、进工具全名，
 * 因此一经发布就不再改变。工具前缀显式写死（`crawler`），不靠推导。
 * The app id and the tool prefix are a **contract** — they appear in page
 * urls, task kinds, and full tool names, so they never change after
 * release. The tool prefix is written out (`crawler`), never derived.
 *
 * @module @veren/crawler/app
 */
import type { AppId, ApplicationDefinition, PageKey } from '@veren/app-registry'

/** 应用 id（稳定，进 URL 与任务 kind）/ the stable app id */
export const APP_ID = 'crawler' as AppId

/** 工具名前缀（进工具全名）/ the tool-name prefix */
export const TOOL_PREFIX = 'crawler'

/** 入口页键 / the entry page key */
export const ENTRY_PAGE = 'overview' as PageKey

/**
 * 应用定义。
 * The application definition.
 */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: '多平台内容采集',
  description: '面向学习研究场景的多平台公开内容采集：关键词搜索、内容详情、创作者主页三种模式，评论伴随采集，数据强制匿名化后进宿主存储域或数据文件。',
  entry: ENTRY_PAGE,
  toolPrefix: TOOL_PREFIX,
  instructions: [
    '这是多平台内容采集的控制台。登录态依赖目标平台：cookie 方式需要用户先提供凭证串，扫码方式需要用户交互完成。',
    '动作只有两类：启停采集（crawler__start / crawler__stop）与查读（crawler__status / crawler__logs / crawler__data）。它们只写本机存储与文件，绝不在目标平台发布或互动。',
    '单任务互斥：启动前先看 crawler__status；错误态再 start 即复位。失败看 crawler__logs；失败码含义见 crawler 技能。',
  ].join(''),
}
