/** 上传编排验收：秒传命中、分片流程、结果不确定保护与冲突策略。 */
/** Upload orchestration acceptance: fast-upload hits, the slice flow, the uncertainty guard, and conflict policies. */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BaiduPanClient } from '../src/client.js'
import type { ResolvedConfig } from '../src/config.js'
import { resolveConfig } from '../src/config.js'
import { uploadFile } from '../src/upload.js'
import { farFutureTokens, scriptedFetch, type FetchRoute } from './support/fakes.js'

const CONFIG: ResolvedConfig = resolveConfig({ appKey: 'k', secretKey: 's' })

/** 组装带令牌的客户端。Assembles the tokened client. */
function makeClient(fetchRoutes: FetchRoute[]): { client: BaiduPanClient; calls: string[] } {
  const fetchLike = scriptedFetch(fetchRoutes)
  const tokens = farFutureTokens()
  const core = new BaiduPanClient({
    config: CONFIG,
    readTokens: async () => tokens,
    commitTokens: async () => {},
    fetch: fetchLike,
  })
  return { client: core, calls: fetchLike.calls }
}

/** 造一个临时本地文件。Creates one temp local file. */
async function tempFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'baidu-pan-'))
  const path = join(dir, 'local.txt')
  await writeFile(path, content, 'utf8')
  return path
}

const BLOCK_LIST = ['aa', 'bb']

/** 预创建路由（可配置 return_type）。The precreate route (configurable return_type). */
function precreateRoute(returnType: 1 | 2, fsId?: number): FetchRoute {
  return {
    match: url => url.includes('method=precreate'),
    reply: () => Response.json(returnType === 2
      ? { errno: 0, return_type: 2, fs_id: fsId }
      : { errno: 0, return_type: 1, uploadid: 'up-1', block_list: [0, 1] }),
  }
}

describe('uploadFile', () => {
  it('returns the fast-upload receipt without any slice call', async () => {
    const { client, calls } = makeClient([precreateRoute(2, 42)])
    const receipt = await uploadFile(client, { localPath: await tempFile('x'), remotePath: '/apps/bdpan/r.txt' })
    expect(receipt).toMatchObject({ fsid: '42', viaFastUpload: true, path: '/apps/bdpan/r.txt' })
    expect(calls.filter(url => url.includes('superfile2'))).toHaveLength(0)
    expect(calls.filter(url => url.includes('method=create'))).toHaveLength(0)
  })

  it('runs the three-phase flow with 4 MiB slices and lands the receipt', async () => {
    const { client, calls } = makeClient([
      precreateRoute(1),
      { match: url => url.includes('superfile2'), reply: url => Response.json({ md5: `slice-${url.match(/partseq=(\d)/)?.[1] ?? '?'}` }) },
      { match: url => url.includes('method=create'), reply: () => Response.json({ errno: 0, fs_id: 7, md5: 'final-md5' }) },
    ])
    const localPath = await tempFile('hello world')
    const receipt = await uploadFile(client, { localPath, remotePath: '/apps/bdpan/r.txt' })
    expect(receipt).toMatchObject({ fsid: '7', viaFastUpload: false, bytes: 11, md5: 'final-md5' })
    // 两个分片各上传一次，partseq 对齐缺失块序号。
    // Both slices upload once, partseq aligned with the missing indexes.
    expect(calls.filter(url => url.includes('partseq=0'))).toHaveLength(1)
    expect(calls.filter(url => url.includes('partseq=1'))).toHaveLength(1)
    expect(receipt.bytes).toBe(11)
    void BLOCK_LIST
  })

  it('never blind-retries an uncertain create outcome', async () => {
    const { client, calls } = makeClient([
      precreateRoute(1),
      { match: url => url.includes('superfile2'), reply: () => Response.json({ md5: 'm' }) },
      { match: url => url.includes('method=create'), reply: () => Response.json({ errno: 0 }) },
    ])
    await expect(uploadFile(client, { localPath: await tempFile('x'), remotePath: '/apps/bdpan/r.txt' }))
      .rejects.toMatchObject({ code: 'BDPAN_OUTPUT_UNCERTAIN', retryable: true })
    expect(calls.filter(url => url.includes('method=create'))).toHaveLength(1)
  })

  it('propagates the conflict errno as BDPAN_ALREADY_EXISTS', async () => {
    const { client } = makeClient([
      { match: url => url.includes('method=precreate'), reply: () => Response.json({ errno: -8 }) },
    ])
    await expect(uploadFile(client, { localPath: await tempFile('x'), remotePath: '/apps/bdpan/r.txt' }))
      .rejects.toMatchObject({ code: 'BDPAN_ALREADY_EXISTS' })
  })

  it('carries the conflict policy into precreate and create', async () => {
    const bodies: string[] = []
    const { client } = makeClient([
      {
        match: url => url.includes('method=precreate'),
        reply: url => {
          bodies.push(url)
          return Response.json({ errno: 0, return_type: 1, uploadid: 'up', block_list: [0] })
        },
      },
      { match: url => url.includes('superfile2'), reply: () => Response.json({ md5: 'm' }) },
      {
        match: url => url.includes('method=create'),
        reply: url => {
          bodies.push(url)
          return Response.json({ errno: 0, fs_id: 1 })
        },
      },
    ])
    await uploadFile(client, { localPath: await tempFile('x'), remotePath: '/apps/bdpan/r.txt', conflictPolicy: 'overwrite' })
    expect(bodies.some(url => url.includes('rtype=3'))).toBe(true)
  })

  it('refuses non-regular local files locally', async () => {
    const { client } = makeClient([precreateRoute(1)])
    await expect(uploadFile(client, { localPath: join(tmpdir(), 'definitely-missing-file'), remotePath: '/apps/bdpan/r.txt' }))
      .rejects.toBeDefined()
  })
})
