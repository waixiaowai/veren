/**
 * The notebook application layer: the `notebook` app's definition, its
 * collected page tools, and the single-entry registration through the host
 * application registry (`ctx.apps`) exactly the way task-workbench does it.
 * This is the notebook's ONLY registration face: the page tools are the
 * `@veren/notebook` builders — the one model-facing implementation — defined
 * into the app catalog here and mounted into page sessions via `meta.tools`;
 * nothing registers into `ctx.tools`. The pages themselves live in
 * `pages.tsx` (standard PageFC + meta form).
 *
 * Single-entry registration: `ctx.apps.pages(id).register(page)` mirrors every
 * page into the page registry internally, so this file never calls
 * `ctx.pageRegistry.registerAppPage` itself.
 *
 * 记事本应用层：`notebook` 应用的定义、收编的页面工具，与经宿主应用注册表
 * （`ctx.apps`）的单入口注册，写法与 task-workbench 一致。这是记事本唯一的注册面：
 * 页面工具就是 `@veren/notebook` 的构建器——唯一的面向模型实现——在本文件 define 进
 * 应用目录，并经 `meta.tools` 挂进页面会话；绝不注册进 `ctx.tools`。页面本体在
 * `pages.tsx`（标准 PageFC + meta 形态）。
 *
 * 单入口注册：`ctx.apps.pages(id).register(page)` 会在内部把页面镜像进页面注册表，
 * 因此本文件绝不直接调用 `ctx.pageRegistry.registerAppPage`。
 *
 * @module @veren/notebook-app/app
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'
// Type-only: pulls `ctx.apps` / `ctx.pageRegistry` declarations into this face.
// 仅类型导入：把 `ctx.apps` / `ctx.pageRegistry` 的声明拉进本文件。
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import {
  buildNotebookDeleteDefinition, buildNotebookListDefinition, buildNotebookReadDefinition,
  buildNotebookRewriteDefinition, buildNotebookWriteDefinition,
} from '@veren/notebook'
import type { NotebookToolsPort } from '@veren/notebook'
import { bindNotebookServices, ListMeta, ListPage, NoteMeta, NotePage } from './pages.tsx'

// ---- 应用定义 / the application definition ----

export const APP_ID = 'notebook' as AppId

/** 应用定义：entry 是应用内页面键，不是 URL / entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: '记事本',
  description: '浏览、撰写、修订每个 agent 预设的私密持久笔记',
  entry: 'list' as PageKey,
  instructions: '记事本负责私密笔记的浏览与撰写：列表页浏览/新建，详情页读取/改写/删除单条笔记。'
    + '所有操作通过本页挂载的 notebook__* 工具完成；工具自动作用于调用者自己的预设，不需要也不能指定归属。',
  toolPrefix: 'notebook',
}

// ---- 应用工具（构建器收编）/ app tools (collected from the builders) ----

/**
 * 收编应用全部页面工具：调用 `@veren/notebook` 导出的构建器，拿到唯一的
 * `ToolDefinition` 实现——本地名应用内唯一；对外名由注册表拼 `notebook__<本地名>`。
 * 归属永远取自调用者，不接受归属参数。这里只登记进应用目录，不注册到 ctx.tools。
 * Collect every page tool: call the builders `@veren/notebook` exports to obtain
 * the one `ToolDefinition` implementation — app-unique local names; the registry
 * composes the external `notebook__<local>` names. The owner always comes from
 * the caller and is never a parameter. This only enters the app catalog, never
 * `ctx.tools`.
 */
export function createAppTools(ctx: Context, port: () => NotebookToolsPort): ToolDefinition[] {
  // 全名（`notebook__<本地名>`，§3.4.3）：组件体在唯一一次渲染里直接
  // agent.ctx.tools.register——没有目录间接层，名字即对外名。
  // Full names (`notebook__<local>`, §3.4.3): the body registers via
  // agent.ctx.tools.register in the one render — no catalog indirection; the
  // name IS the external name.
  return [
    buildNotebookListDefinition(ctx, port),
    buildNotebookReadDefinition(ctx, port),
    buildNotebookWriteDefinition(ctx, port),
    buildNotebookRewriteDefinition(ctx, port),
    buildNotebookDeleteDefinition(ctx, port),
  ].map((tool) => ({ ...tool, name: `notebook__${tool.name}` }))
}

// ---- 单入口注册 / the single-entry registration ----

/**
 * Register the whole application (definition → tools → pages) in one effect
 * whose body rolls back every finished step when a later one fails — no
 * half-wired "app present, pages missing" state. Disposing reverses
 * pages → tools → definition.
 *
 * 在一个 effect 里注册整个应用（定义 → 工具 → 页面）；体内任何一步失败都把已完成的
 * 步骤逆序回滚，不留"应用在、页面缺"的半接线状态。卸载按 页面 → 工具 → 定义 逆序清理。
 *
 * @param ctx - the context owning the registration (its fiber tears the app down).
 * @param port - resolves the notebook surface the page tools act through.
 */
export function registerNotebookApp(ctx: Context, port: () => NotebookToolsPort): void {
  const apps = ctx.apps
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) 工具以全名备好：组件体在唯一一次渲染里直接 agent.ctx.tools.register。
      // 2) Tools are prepared under full names: the body registers via
      //    agent.ctx.tools.register in the one render.
      const tools = createAppTools(ctx, port)
      // 3) 页面注册（一次性渲染形态）：工厂产出的 PageFC + meta 直接注册，
      //    单入口内部自动镜像进 page-registry（可被 openUrl 解析）。
      //    Page registration (one-shot form): the factory's PageFC + meta pairs
      //    register directly, single entry mirrored into the page registry
      //    (openUrl-resolvable).
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(ListPage, ListMeta))
      done.push(pages.register(NotePage, NoteMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of done.reverse()) dispose() }
  }, 'notebook:app()')
}
