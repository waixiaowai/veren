import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from '../../src/index.ts'
import {
  createExpressOrmMiddleware,
  getExpressOrm,
  type ExpressRequestLike,
} from '../../src/adapters/express.ts'
import '../../src/driver/sqlite.ts'

@Entity('express_items')
class ExpressItem {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  label!: string
}

const sources: DataSource[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建数据源。 / Build a source. */
async function createSource(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [ExpressItem], synchronize: true })
  await source.initialize()
  sources.push(source)
  return source
}

/** 启动真实 Express 应用并返回基地址。 / Start a real Express app and return its base URL. */
function startApp(source: DataSource): Promise<string> {
  const app = express()
  app.use(express.json())
  app.use(createExpressOrmMiddleware(source) as unknown as express.RequestHandler)
  app.post('/items', async (request, response) => {
    const manager = getExpressOrm(request as unknown as ExpressRequestLike)
    const body = request.body as { label: string }
    const saved = await manager.getRepository(ExpressItem).save({ label: body.label } as ExpressItem)
    response.status(201).json(saved)
  })
  app.get('/items', async (request, response) => {
    const manager = getExpressOrm(request as unknown as ExpressRequestLike)
    response.json(await manager.getRepository(ExpressItem).find())
  })
  app.post('/failing', async (request, response) => {
    const manager = getExpressOrm(request as unknown as ExpressRequestLike)
    await manager.getRepository(ExpressItem).save({ label: 'rolled-back' } as ExpressItem)
    response.status(500).json({ ok: false })
  })
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      servers.push(server)
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    })
  })
}

/** 等待行数稳定。 / Wait until the row count settles. */
async function waitForCount(source: DataSource, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await source.getRepository(ExpressItem).count() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`row count did not settle at ${expected}`)
}

describe('express real framework integration', () => {
  it('commits successful requests and rolls back failing ones', async () => {
    const source = await createSource()
    const base = await startApp(source)

    const created = await fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'first' }),
    })
    expect(created.status).toBe(201)
    expect((await created.json() as ExpressItem).label).toBe('first')
    await waitForCount(source, 1)

    const listed = await fetch(`${base}/items`)
    expect(listed.status).toBe(200)
    expect((await listed.json() as ExpressItem[])).toHaveLength(1)

    const failed = await fetch(`${base}/failing`, { method: 'POST' })
    expect(failed.status).toBe(500)
    await waitForCount(source, 1)
  })
})
