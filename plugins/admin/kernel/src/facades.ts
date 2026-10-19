/**
 * Stable capability façades.
 *
 * A façade is a proxy that resolves the active provider on every access. The
 * consumer keeps one stable object across provider replacement, so an in-flight
 * request and a live UI subscription both survive a swap.
 *
 * 稳定能力 façade。façade 是每次访问时解析当前可见 provider 的代理。消费方在
 * provider 被替换时仍持有同一个稳定对象，因此进行中的请求与实时 UI 订阅都能跨替换存活。
 *
 * @module @veren/admin-kernel/facades
 */

import type { CapabilityName } from '@veren/admin-contract'
import type { AdminKernel } from './plugin.ts'

/**
 * Properties a proxy must not forward: symbols and `then` would either confuse
 * inspection or turn the façade into a promise, neither of which is intended.
 *
 * 代理不得转发的属性：symbol 会干扰内省，`then` 会把 façade 变成 thenable，两者都
 * 不是本意。
 */
function isForwarded(key: string | symbol): key is string {
  return typeof key === 'string' && key !== 'then'
}

/**
 * Build one capability façade over a kernel.
 *
 * @param kernel - the kernel owning the registry 拥有注册表的内核
 * @param capability - capability the façade proxies 该 façade 代理的能力
 * @returns a proxy whose every member reads the active implementation 成员读取当前实现的代理
 */
export function createFacade<T extends object>(kernel: AdminKernel, capability: CapabilityName): T {
  return new Proxy({} as T, {
    get: (_target, key) => {
      if (!isForwarded(key)) return undefined
      const implementation = kernel.require<Record<string, unknown>>(capability)
      const value = implementation[key]
      return typeof value === 'function' ? value.bind(implementation) : value
    },
    has: (_target, key) => isForwarded(key) && key in kernel.require<object>(capability),
    ownKeys: () => Reflect.ownKeys(kernel.require<object>(capability)),
    getOwnPropertyDescriptor: (_target, key) => {
      if (!isForwarded(key)) return undefined
      const implementation = kernel.require<object>(capability)
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, key)
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    },
  })
}
