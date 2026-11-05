/**
 * DSH Cordis 薄入口：把数据源注册为 `ctx.verenOrm` 服务。
 * 核心不依赖 cordis；只有这个子路径需要 `@deepseek-ai/cordis` 与
 * `@deepseek-ai/schemastery`（作为对等依赖由宿主提供）。
 *
 * The DSH Cordis thin entry: registers the data source as the `ctx.verenOrm`
 * service. The core never depends on cordis; only this sub-path needs
 * `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` as host-provided peers.
 *
 * @module @veren/orm/cordis
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DataSource } from '../runtime/data-source.ts'
import type { EntityManager } from '../runtime/entity-manager.ts'
import type { Repository } from '../runtime/repository.ts'
import type { DataSourceOptions, EntityTarget, IsolationLevel } from '../types.ts'

/** 服务名（同时是 ctx 上的属性名）。 / Service name (also the property name on ctx). */
export const name = 'verenOrm'

/** 不依赖其他服务。 / Depends on no other service. */
export const inject: string[] = []

/** 本插件提供的服务名。 / The service names this plugin provides. */
export const provide = [name]

/** 同步数据源工厂；异步场景请先在外部构造好 DataSource。 / Synchronous data source factory; build asynchronously outside and pass the instance instead. */
export type DataSourceFactory = () => DataSource

/** 插件配置。 / Plugin configuration. */
export interface Config {
  /** 现成数据源或工厂；与 `options` 二选一 / a ready data source or factory, exclusive with `options` */
  dataSource?: DataSource | DataSourceFactory
  /** 声明式配置；由插件构造数据源 / declarative options used to construct one */
  options?: DataSourceOptions
  /** 是否在插件加载时自动初始化，默认 true / auto-initialize on load, default true */
  autoInitialize: boolean
}

/** 配置 schema；数据源与选项是运行时对象，用 any 保持可校验、可透传。 / Config schema; data sources and options are runtime objects, so `any` keeps them pass-through. */
export const Config = z.object({
  dataSource: z.any(),
  options: z.any(),
  autoInitialize: z.boolean().default(true),
})

/** ORM 服务：暴露数据源、管理器与事务。 / The ORM service: exposes the data source, manager and transactions. */
export class OrmService extends Service {
  constructor(
    ctx: Context,
    readonly dataSource: DataSource,
  ) {
    super(ctx, name)
  }

  /** 全局管理器 / the global entity manager */
  get manager(): EntityManager {
    return this.dataSource.manager
  }

  /** 领取仓储。 / Get a repository. */
  getRepository<Entity extends object = object>(target: EntityTarget<Entity>): Repository<Entity> {
    return this.dataSource.getRepository(target)
  }

  /** 事务透传。 / Transaction pass-through. */
  transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T>
  transaction<T>(isolation: IsolationLevel, run: (manager: EntityManager) => Promise<T>): Promise<T>
  transaction<T>(
    isolationOrRun: IsolationLevel | ((manager: EntityManager) => Promise<T>),
    maybeRun?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return typeof isolationOrRun === 'function'
      ? this.dataSource.transaction(isolationOrRun)
      : this.dataSource.transaction(isolationOrRun, maybeRun!)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** ORM 服务入口 / the ORM service entry */
    verenOrm: OrmService
  }
}

/**
 * 插件入口：注册服务，并把数据源生命周期挂到当前 fiber。
 * Cordis 卸载时逆序释放：销毁数据源即关闭连接池与缓存。
 *
 * Plugin entry: register the service and bind the data source lifecycle to the
 * current fiber. On unload, resources release in reverse order: destroying the
 * data source closes the pool and caches.
 */
export const apply = (ctx: Context, config: Config): (() => Promise<void>) => {
  const source = resolveDataSource(config)
  new OrmService(ctx, source)
  return ctx.effect(async () => {
    if (config.autoInitialize) await source.initialize()
    return async () => {
      await source.destroy()
    }
  }, 'verenOrm.dataSource')
}

/** 解析现成数据源或按选项构造一个。 / Resolve a ready data source or construct one from options. */
function resolveDataSource(config: Config): DataSource {
  const injected = config.dataSource
  if (typeof injected === 'function') return injected()
  if (injected !== undefined) return injected
  if (config.options !== undefined) return new DataSource(config.options)
  throw new Error('verenOrm requires either "dataSource" or "options" / 需要提供 dataSource 或 options')
}
