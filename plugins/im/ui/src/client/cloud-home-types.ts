/**
 * Shared types of the cloud tab's signed-in home: the translation face, one
 * directory read, and one in-flight rename/note draft.
 *
 * 云端页签已登录主视图的共享类型：翻译面、一次目录读取，以及一条编辑中的改名/备注草稿。
 *
 * @module @veren/im-ui/client/cloud-home-types
 */

import type { ImKey } from './locales.ts'
import type { CmsAddress, CmsPerson } from './cms.ts'

/** The dictionary face the cloud views render through. */
/** 云端视图渲染所经的词典面。 */
export type Translate = (key: ImKey) => string

/** One people-directory read: the rows plus each person's address bindings. */
/** 一次人员目录读取：行数据加每个人的地址绑定。 */
export interface DirectoryData {
  readonly people: readonly CmsPerson[]
  readonly addresses: Readonly<Record<string, readonly CmsAddress[]>>
}

/** One in-flight rename/note draft, keyed by its person. */
/** 一条编辑中的改名/备注草稿，按所属人员标识。 */
export interface EditDraft {
  readonly id: string
  readonly displayName: string
  readonly note: string
}
