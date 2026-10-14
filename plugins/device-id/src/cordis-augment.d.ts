/**
 * Module augmentation: expose the mounted domain facility as `ctx.storageDomain`.
 * 模块增强：把已挂载的 domain 设施暴露为 `ctx.storageDomain`。
 */

import type {} from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Mounted by the host's storage-domain plugin. 由宿主 storage-domain 插件挂载。 */
    storageDomain: import('@deepseek-ai/dsh-storage-domain').DomainFacility;
  }
}
