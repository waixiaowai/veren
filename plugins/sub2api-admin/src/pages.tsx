/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 页面域的组装入口：只做 re-export，不放业务逻辑。真实实现按职责域拆在同级
 * 文件里——`page-runtime.ts`（装配槽位/工具登记/store 直读/行投影）、
 * `page-home.tsx`（指挥台）、`page-lists.tsx`（五个通用列表页）、
 * `page-finance.tsx`（资金）、`page-codes.tsx`（卡密）、`page-usage.tsx`（用量）。
 * index.ts 与测试从本入口取页面对；页面实现细节不外泄。
 * The page domain's assembly entry: re-exports only, no business logic. The
 * real implementations live by responsibility domain in sibling files —
 * `page-runtime.ts` (the assembly slot / tool registration / store read / row
 * projection), `page-home.tsx` (the ops console), `page-lists.tsx` (the five
 * generic list pages), `page-finance.tsx`, `page-codes.tsx`, and
 * `page-usage.tsx`. index.ts and the tests take the page pairs from this
 * entry; the page implementation details stay inside.
 *
 * @module @veren/sub2api-admin/pages
 */
export { APP_ID } from './app-definition.ts'
export { bindSub2ApiRuntime, externalName } from './page-runtime.ts'
export { HomeMeta, HomePage } from './page-home.tsx'
export {
  AccountsMeta, AccountsPage,
  ChannelsMeta, ChannelsPage,
  GroupsMeta, GroupsPage,
  SubscriptionsMeta, SubscriptionsPage,
  UsersMeta, UsersPage,
} from './page-lists.tsx'
export { FinanceMeta, FinancePage } from './page-finance.tsx'
export { CodesMeta, CodesPage } from './page-codes.tsx'
export { UsageMeta, UsagePage } from './page-usage.tsx'
