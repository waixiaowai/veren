import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from '../../src/index.ts'
import { createHonoOrmMiddleware, getHonoOrm } from '../../src/adapters/hono.ts'
import '../../src/driver/sqlite.ts'

@Entity('http_items')
class HttpItem {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  label!: string
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建数据源。 / Build a source. */
async function createSource(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [HttpItem], synchronize: true })
  await source.initialize()
  sources.push(source)
  return source
}

/** 建一个真实的 Hono 应用。 / Build a real Hono app. */
function createApp(source: DataSource): Hono {
  const app = new Hono()
  app.use('*', createHonoOrmMiddleware(source))
  app.post('/items', async (context) => {
    const body = await context.req.json<{ label: string }>()
    const saved = await getHonoOrm(context).getRepository(HttpItem).save({ label: body.label } as HttpItem)
    return context.json(saved, 201)
  })
  app.get('/items', async (context) => {
    return context.json(await getHonoOrm(context).getRepository(HttpItem).find())
  })
  app.post('/failing', async (context) => {
    await getHonoOrm(context).getRepository(HttpItem).save({ label: 'rolled-back' } as HttpItem)
    context.status(500)
    return context.json({ ok: false }, 500)
  })
  return app
}

describe('hono real framework integration', () => {
  it('commits successful requests and rolls back failing ones', async () => {
    const source = await createSource()
    const app = createApp(source)
    const repository = source.getRepository(HttpItem)

    const created = await app.request('/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'first' }),
    })
    expect(created.status).toBe(201)
    expect((await created.json() as HttpItem).label).toBe('first')
    expect(await repository.count()).toBe(1)

    const listed = await app.request('/items')
    expect(listed.status).toBe(200)
    expect((await listed.json() as HttpItem[])).toHaveLength(1)

    const failed = await app.request('/failing', { method: 'POST' })
    expect(failed.status).toBe(500)
    expect(await repository.count()).toBe(1)
  })
})
