import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
} from '../src/index.ts'
import * as ormPlugin from '../src/adapters/cordis.ts'
import { apply as applyCordis, OrmService } from '../src/adapters/cordis.ts'
import {
  createExpressOrmMiddleware,
  type ExpressRequestLike,
  type ExpressResponseLike,
} from '../src/adapters/express.ts'
import {
  createHonoOrmMiddleware,
  getHonoOrm,
  type HonoContextLike,
} from '../src/adapters/hono.ts'
import '../src/driver/sqlite.ts'

@Entity('items')
class Item {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  label!: string
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建一个内存数据源。 / Build an in-memory source. */
async function createSource(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [Item], synchronize: true })
  await source.initialize()
  sources.push(source)
  return source
}

/** 等待条件成立。 / Wait until a condition holds. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('condition not met in time')
}

describe('thin adapters', () => {
  it('mounts onto a Cordis context and disposes with the fiber', async () => {
    const source = await createSource()
    const ctx = new Context()
    const dispose = applyCordis(ctx, { dataSource: source, autoInitialize: false })
    expect(ctx.verenOrm).toBeInstanceOf(OrmService)
    expect(ctx.verenOrm.dataSource).toBe(source)
    await dispose()
    expect(source.isInitialized).toBe(false)
  })

  it('loads through the real Cordis plugin registry and disposes with the fiber', async () => {
    const source = await createSource()
    const ctx = new Context()
    const fiber = ctx.plugin(ormPlugin as never, { dataSource: source, autoInitialize: false } as never)
    await fiber.await()
    expect(ctx.verenOrm).toBeInstanceOf(OrmService)
    expect(ctx.verenOrm.dataSource).toBe(source)
    await fiber.dispose()
    expect(source.isInitialized).toBe(false)
  })

  it('mounts a Hono middleware with commit and rollback semantics', async () => {
    const source = await createSource()
    const middleware = createHonoOrmMiddleware(source)
    const context = new FakeHonoContext()

    await middleware(context, async () => {
      await getHonoOrm(context).getRepository(Item).save({ label: 'hono' } as Item)
    })
    expect(await source.getRepository(Item).count()).toBe(1)

    context.res = { status: 500 }
    await middleware(context, async () => {
      await getHonoOrm(context).getRepository(Item).save({ label: 'rolled' } as Item)
    })
    expect(await source.getRepository(Item).count()).toBe(1)
  })

  it('mounts an Express middleware and settles on response finish', async () => {
    const source = await createSource()
    const middleware = createExpressOrmMiddleware(source)
    const request: ExpressRequestLike = {}
    const response = new FakeExpressResponse()
    const next = new Promise<void>((resolve) => {
      middleware(request, response, () => resolve())
    })
    await next

    const manager = request.orm as import('../src/index.ts').EntityManager
    await manager.getRepository(Item).save({ label: 'express' } as Item)
    response.emit('finish')
    await waitFor(() => !manager.queryRunner?.isTransactionActive)
    expect(await source.getRepository(Item).count()).toBe(1)
  })
})

/** 假 Hono 上下文。 / A fake Hono context. */
class FakeHonoContext implements HonoContextLike {
  private readonly store = new Map<string, unknown>()
  res: { status: number } | undefined

  get(key: string): unknown {
    return this.store.get(key)
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value)
  }
}

/** 假 Express 响应：记录并触发 finish/close。 / Fake Express response that records and fires finish/close. */
class FakeExpressResponse implements ExpressResponseLike {
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
