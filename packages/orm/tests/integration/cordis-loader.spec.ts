import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn, type EntityManager } from '../../src/index.ts'
import * as ormPlugin from '../../src/adapters/cordis.ts'
import '../../src/driver/sqlite.ts'

@Entity('loader_items')
class LoaderItem {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  label!: string
}

describe('cordis loader composition', () => {
  it('loads the ORM plugin through a real Loader entry', async () => {
    const root = new Context()
    await root.plugin(Loader, { baseUrl: import.meta.url })
    root.loader.builtins.verenOrm = ormPlugin

    const id = await root.loader.create({
      name: 'cordis:verenOrm',
      config: {
        options: { type: 'sqlite', entities: [LoaderItem], synchronize: true },
        autoInitialize: true,
      },
    })
    await root.loader.await()
    const entry = root.loader.resolve(id)
    await entry.fiber?.await()

    let manager: EntityManager | undefined
    const probe = entry.ctx.inject(['verenOrm'], (scope) => {
      manager = scope.verenOrm.manager
    })
    await probe
    const source = manager!.dataSource
    await waitFor(() => source.isInitialized)
    expect(manager?.dataSource).toBe(source)
    const saved = await manager!.getRepository(LoaderItem).save({ label: 'loaded' } as LoaderItem)
    expect(saved.id).toBe(1)

    root.loader.remove(id)
    await waitFor(() => !source.isInitialized)
    await source.destroy()
  })

  it('lets a Loader entry inject the service mounted on the app root', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [LoaderItem], synchronize: true })
    await source.initialize()
    const observed: string[] = []
    const consumer = {
      name: 'loader-consumer',
      inject: ['verenOrm'],
      apply: (scope: Context) => {
        observed.push(scope.verenOrm.manager.dataSource === source ? 'bound' : 'other')
        observed.push(scope.verenOrm.getRepository(LoaderItem).metadata.tableName)
      },
    }

    const root = new Context()
    const loaderFiber = await root.plugin(Loader, { baseUrl: import.meta.url })
    const ormFiber = root.plugin(ormPlugin as never, { dataSource: source, autoInitialize: false } as never)
    await ormFiber.await()
    root.loader.builtins.consumer = consumer

    const id = await root.loader.create({ name: 'cordis:consumer' })
    await root.loader.await()
    await root.loader.resolve(id).fiber?.await()
    expect(observed).toEqual(['bound', 'loader_items'])

    root.loader.remove(id)
    await loaderFiber.dispose()
    await ormFiber.dispose()
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
