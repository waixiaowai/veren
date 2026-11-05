import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from '../../src/index.ts'
import * as ormPlugin from '../../src/adapters/cordis.ts'
import '../../src/driver/sqlite.ts'

@Entity('cordis_items')
class CordisItem {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  label!: string
}

describe('cordis composition integration', () => {
  it('resolves ctx.verenOrm as an injectable service for downstream plugins', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [CordisItem], synchronize: true })
    await source.initialize()
    const ctx = new Context()
    const observed: string[] = []

    const ormFiber = ctx.plugin(ormPlugin as never, { dataSource: source, autoInitialize: false } as never)
    const consumer = {
      name: 'integration-consumer',
      inject: ['verenOrm'],
      apply: (scope: Context) => {
        const manager = scope.verenOrm.manager
        observed.push(manager.dataSource === source ? 'bound' : 'other')
        const repository = scope.verenOrm.getRepository(CordisItem)
        observed.push(repository.metadata.tableName)
      },
    }
    const consumerFiber = ctx.plugin(consumer as never, undefined as never)
    await consumerFiber.await()

    expect(observed).toEqual(['bound', 'cordis_items'])
    expect(ctx.verenOrm.dataSource).toBe(source)
    await consumerFiber.dispose()
    await ormFiber.dispose()
    await source.destroy()
  })

  it('destroys the data source when the owning fiber unloads', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [CordisItem] })
    const ctx = new Context()
    const fiber = ctx.plugin(ormPlugin as never, { dataSource: source, autoInitialize: true } as never)
    await fiber.await()
    await waitFor(() => source.isInitialized)
    await fiber.dispose()
    await waitFor(() => !source.isInitialized)
    await source.destroy()
  })
})

/** 等待条件成立。 / Wait until a condition holds. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not met')
}
