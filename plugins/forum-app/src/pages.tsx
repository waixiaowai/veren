/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 论坛页面域的组装入口：只做 re-export，不放业务逻辑。真实实现按职责域拆在
 * 同级文件里——`page-runtime.ts`（服务槽位/工具登记/任务回报面/followup 送达）、
 * `page-catalog.tsx`（入口页）、`page-post.tsx`（详情页）。app.ts 与测试从本
 * 入口取页面对，页面实现细节不外泄。
 * The forum page domain's assembly entry: re-exports only, no business logic.
 * The real implementations live by responsibility domain in sibling files —
 * `page-runtime.ts` (the service slot / tool registration / delivery-report
 * face / followup), `page-catalog.tsx` (the entry page), and `page-post.tsx`
 * (the detail page). app.ts and the tests take the page pairs from this entry;
 * the page implementation details stay inside.
 *
 * @module @veren/forum-app/pages
 */
export { bindForumServices } from './page-runtime.ts'
export { CatalogMeta, CatalogPage } from './page-catalog.tsx'
export { PostMeta, PostPage } from './page-post.tsx'
