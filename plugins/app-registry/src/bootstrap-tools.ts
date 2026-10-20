/**
 * 宿主引导工具：app_list / app_pages（§8.1）。
 * Host bootstrap tools: app_list / app_pages.
 *
 * - `app_open` 归 page-registry（会话 C）实现，这里不做；
 * - `requires` 能力第 1 阶段只记录并在目录中明示，不做强制（已定取舍）；
 * - execute 永不抛异常：失败返回结构化 { error: { code, message } }，模型可自行判断。
 * - `app_open` belongs to page-registry (session C), not here;
 * - capability `requires` is recorded and surfaced, not enforced (agreed tradeoff);
 * - execute never throws: failures come back as structured { error: { code, message } }.
 */
import type { AppToolDefinition } from './types.ts'
import { AppErrorCode } from './types.ts'
import type { AppRegistryService } from './service.ts'
import type { AppId } from './types.ts'

/** 引导工具集合形状 / shape of the bootstrap tool set */
export interface BootstrapTools {
  readonly appList: AppToolDefinition
  readonly appPages: AppToolDefinition
}

/** 描述文本里给模型的使用指引（不靠文档也能用）/ model-facing usage hints baked into descriptions */
const APP_LIST_DESCRIPTION = [
  '列出当前宿主已安装的所有应用。',
  '返回 { apps: [...] }，每项含：id、name、description、entryUrl（入口页面 URL，形如 /apps/<appId>/...；broken 应用为 null）、state（active 可用 / disabled 已禁用 / broken 损坏，附 brokenReason）、toolPrefix。',
  '只把 state 为 active 且 entryUrl 非 null 的应用当作可用；拿到 entryUrl 后用 app_open 工具（参数 url=entryUrl）打开应用入口。',
].join('')

const APP_PAGES_DESCRIPTION = [
  '列出某个应用的全部页面。参数：appId（先用 app_list 查到）。',
  '返回 { appId, pages: [...] }，每项含：pageKey（形如 <appId>/<pageName>）、urlPattern（形如 /apps/<appId>/...，:xxx 为路径参数）、description、isEntry（是否入口页）、tools（本页可用的工具最终名列表）、pageRevision。',
  '要打开某页：把 urlPattern 中的 :参数 替换为实际值得到具体 URL，再用 app_open 工具（参数 url）打开。',
].join('')

/** 构造两个宿主引导工具 / build the two bootstrap tools */
export function createBootstrapTools(apps: AppRegistryService): BootstrapTools {
  return {
    appList: {
      name: 'app_list',
      description: APP_LIST_DESCRIPTION,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ apps: catalogView(apps) }),
    },
    appPages: {
      name: 'app_pages',
      description: APP_PAGES_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: { appId: { type: 'string', description: '应用 id，来自 app_list 的返回' } },
        required: ['appId'],
        additionalProperties: false,
      },
      execute: async (args: unknown) => pagesView(apps, args),
    },
  }
}

/** app_list 的返回视图（入口缺失时 entryUrl 为 null）/ the app_list view */
function catalogView(apps: AppRegistryService): unknown[] {
  return apps.catalog().map((record) => {
    const entryPage = record.state === 'broken'
      ? undefined
      : safePages(apps, record.definition.id).find((page) => page.name === record.definition.entry)
    return {
      id: record.definition.id,
      name: record.definition.name,
      description: record.definition.description,
      entryUrl: entryPage?.url ?? null,
      state: record.state,
      ...(record.brokenReason === undefined ? {} : { brokenReason: record.brokenReason }),
      toolPrefix: record.toolPrefix,
    }
  })
}

/** app_pages 的返回视图；入参/状态不合法返回结构化错误 / the app_pages view */
function pagesView(apps: AppRegistryService, args: unknown): unknown {
  const appId = (args as { appId?: unknown } | null)?.appId
  if (typeof appId !== 'string' || appId.length === 0) {
    return { error: { code: AppErrorCode.ManifestInvalid, message: 'appId must be a non-empty string' } }
  }
  const record = apps.get(appId as AppId)
  if (!record) return { error: { code: AppErrorCode.NotFound, message: `app "${appId}" is not registered` } }
  if (record.state === 'disabled') return { error: { code: AppErrorCode.Disabled, message: `app "${appId}" is disabled` } }
  if (record.state === 'broken') {
    return { error: { code: AppErrorCode.EntryMissing, message: record.brokenReason ?? `app "${appId}" is broken` } }
  }
  return {
    appId,
    pages: safePages(apps, appId).map((page) => ({
      pageKey: `${appId}/${page.name}`,
      urlPattern: page.url,
      description: page.description,
      isEntry: page.name === record.definition.entry,
      tools: (page.tools ?? []).map((local) => `${record.toolPrefix}__${local}`),
      pageRevision: page.pageRevision ?? 1,
    })),
  }
}

/** 防御式页面清单（get() 已保证存在，这里兜底为空）/ defensive page listing */
function safePages(apps: AppRegistryService, appId: string) {
  try {
    return apps.listPages(appId as AppId)
  } catch {
    return []
  }
}
