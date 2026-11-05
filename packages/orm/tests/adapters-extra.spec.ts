import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from '../src/index.ts'
import * as ormPlugin from '../src/adapters/cordis.ts'
import { createExpressOrmMiddleware, getExpressOrm } from '../src/adapters/express.ts'
import { createHonoOrmMiddleware, getHonoOrm, type HonoContextLike } from '../src/adapters/hono.ts'
import '../src/driver/sqlite.ts'

@Entity('extra_items')
class ExtraItem {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  label!: string
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建数据源。 / Build a source. */
async function createSource(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [ExtraItem], synchronize: true })
  await source.initialize()
  sources.push(source)
  return source
}

/** 等到条件成立。 / Wait until a condition holds. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('condition not met')
}

describe('cordis adapter surface', () => {
  it('constructs a data source from options and initializes it', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(ormPlugin as never, {
      options: { type: 'sqlite', entities: [ExtraItem], synchronize: true },
      autoInitialize: true,
    } as never)
    await fiber.await()
    await waitFor(() => ctx.verenOrm.dataSource.isInitialized)
    const saved = await ctx.verenOrm.getRepository(ExtraItem).save({ label: 'arg' } as ExtraItem)
    expect(saved.id).toBe(1)
    expect(ctx.verenOrm.manager).toBe(ctx.verenOrm.dataSource.manager)
    await fiber.dispose()
  })

  it('accepts a synchronous factory and rejects missing configuration', async () => {
    const source = await createSource()
    const ctx = new Context()
    const fiber = ctx.plugin(ormPlugin as never, { dataSource: () => source, autoInitialize: false } as never)
    await fiber.await()
    expect(ctx.verenOrm.dataSource).toBe(source)
    await fiber.dispose()

    const broken = new Context()
    expect(() => ormPlugin.apply(broken, { autoInitialize: true })).toThrow(/dataSource|options/)
  })

  it('exposes both transaction overloads', async () => {
    const source = await createSource()
    const ctx = new Context()
    const fiber = ctx.plugin(ormPlugin as never, { dataSource: source, autoInitialize: false } as never)
    await fiber.await()

    await ctx.verenOrm.transaction(async (manager) => {
      await manager.getRepository(ExtraItem).save({ label: 'one' } as ExtraItem)
    })
    await ctx.verenOrm.transaction('SERIALIZABLE', async (manager) => {
      await manager.getRepository(ExtraItem).save({ label: 'two' } as ExtraItem)
    })
    expect(await source.getRepository(ExtraItem).count()).toBe(2)
    await fiber.dispose()
  })
})

describe('hono adapter edge paths', () => {
  it('throws a clear error when the middleware is not mounted', () => {
    const context = new FakeHono()
    expect(() => getHonoOrm(context)).toThrow(/No ORM entity manager/)
  })

  it('runs without a transaction when requested and rolls back on errors', async () => {
    const source = await createSource()
    const middleware = createHonoOrmMiddleware(source, { transaction: false })
    const context = new FakeHono()
    await middleware(context, async () => {
      await getHonoOrm(context).getRepository(ExtraItem).save({ label: 'plain' } as ExtraItem)
    })
    expect(await source.getRepository(ExtraItem).count()).toBe(1)

    const transactional = createHonoOrmMiddleware(source)
    await expect(transactional(context, async () => {
      await getHonoOrm(context).getRepository(ExtraItem).save({ label: 'boom' } as ExtraItem)
      throw new Error('handler failed')
    })).rejects.toThrow('handler failed')
    expect(await source.getRepository(ExtraItem).count()).toBe(1)
  })
})

describe('express adapter edge paths', () => {
  it('throws a clear error when the middleware is not mounted', () => {
    expect(() => getExpressOrm({})).toThrow(/No ORM entity manager/)
  })

  it('rolls back on close and forwards connection failures', async () => {
    const source = await createSource()
    const middleware = createExpressOrmMiddleware(source)
    const request: Record<string, unknown> = {}
    const response = new FakeExpress()
    const next = new Promise<void>((resolve) => {
      middleware(request, response, () => resolve())
    })
    await next
    const manager = getExpressOrm(request)
    await manager.getRepository(ExtraItem).save({ label: 'close' } as ExtraItem)
    response.emit('close')
    await waitFor(() => !manager.queryRunner?.isTransactionActive)
    expect(await source.getRepository(ExtraItem).count()).toBe(0)

    const failing = createExpressOrmMiddleware(source, { transaction: false })
    let error: unknown
    const failedNext = new Promise<void>((resolve) => {
      failing(request, response, (received) => { error = received; resolve() })
    })
    response.statusCode = 500
    response.emit('close')
    await failedNext
    expect(error).toBeUndefined()
  })
})

/** 假 Hono 上下文。 / Fake Hono context. */
class FakeHono implements HonoContextLike {
  private readonly store = new Map<string, unknown>()
  res: { status: number } | undefined

  get(key: string): unknown {
    return this.store.get(key)
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value)
  }
}

/** 假 Express 响应。 / Fake Express response. */
class FakeExpress {
  statusCode = 200
  private readonly listeners = new Map<'finish' | 'close', Array<() => void>>()

  on(event: 'finish' | 'close', listener: () => void): void {
    const bucket = this.listeners.get(event)
    if (bucket === undefined) this.listeners.set(event, [listener])
    else bucket.push(listener)
  }

  emit(event: 'finish' | 'close'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}
