import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, stat, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeFileName, inferExtension, isAllowedExtension, guardWithin, buildMediaPath } from '../src/media/paths.ts'
import { MediaDownloader, type MediaFetcher, type MediaItem } from '../src/media/downloader.ts'
import { CrawlerError } from '../src/errors.ts'

// 媒体下载验收（design/modules/downloader.md §4）：成功落盘、失败隔离、
// 续传跳过、目录穿越防护、合流。
// Downloader acceptance (design downloader.md §4): persisted bytes,
// failure isolation, resume skipping, escape protection, merging.
async function makeRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'crawler-media-'))
}

const policy = (root: string) => ({ root, platform: 'xhs' })

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    url: 'https://cdn.example.com/pic.jpg',
    fallbackUrls: [],
    type: 'image',
    contentId: 'note-1',
    isDash: false,
    ...overrides,
  }
}

const okFetcher: MediaFetcher = async () => ({ bytes: Buffer.from('binary-bytes'), contentType: 'image/jpeg' })

describe('paths', () => {
  it('sanitizes unsafe chars, reserved names and overlong names', () => {
    expect(sanitizeFileName('a/b:c?.jpg')).toBe('a_b_c_.jpg')
    expect(sanitizeFileName('CON.mp4')).toMatch(/^_CON\.mp4$/)
    expect(sanitizeFileName('   ')).toBe('media')
    expect(sanitizeFileName('x'.repeat(200)).length).toBeLessThanOrEqual(120)
  })

  it('infers extensions with the explicit → url → default priority', () => {
    expect(inferExtension('.mp4', 'https://x.com/a.bin')).toBe('.mp4')
    expect(inferExtension(null, 'https://x.com/a.png')).toBe('.png')
    expect(inferExtension(null, 'https://x.com/a.bin')).toBe('.jpg')
    expect(isAllowedExtension('.mp4')).toBe(true)
    expect(isAllowedExtension('.exe')).toBe(false)
  })

  it('guards paths inside the data root and builds the media layout', () => {
    const root = join('C:', 'data')
    expect(() => guardWithin(root, join(root, '..', 'evil.mp4'))).toThrowError(CrawlerError)
    expect(() => guardWithin(root, join(root, 'x', 'ok.mp4'))).not.toThrow()
    const path = buildMediaPath(policy(root), 'n1', 'file.jpg')
    expect(path).toContain(join('xhs', 'media', 'n1'))
  })
})

describe('MediaDownloader', () => {
  it('persists bytes under the platform media layout and removes .part', async () => {
    const root = await makeRoot()
    try {
      const report = await new MediaDownloader({ policy: policy(root), fetcher: okFetcher }).downloadAll([item()])
      expect(report.succeeded).toHaveLength(1)
      expect(report.failed).toHaveLength(0)
      const dir = join(root, 'xhs', 'media', 'note-1')
      const files = await readdir(dir)
      expect(files).toEqual(['note-1.jpg'])
      expect((await stat(join(dir, files[0]))).size).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('isolates failures and reports them without throwing', async () => {
    const root = await makeRoot()
    try {
      const failing: MediaFetcher = async () => {
        throw new Error('404')
      }
      const report = await new MediaDownloader({ policy: policy(root), fetcher: failing }).downloadAll([
        item({ contentId: 'bad' }),
        item({ contentId: 'good', url: 'https://cdn.example.com/2.jpg' }),
      ])
      expect(report.failed).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('walks the fallback chain before giving up', async () => {
    const root = await makeRoot()
    try {
      const tried: string[] = []
      const fetcher: MediaFetcher = async (url) => {
        tried.push(url)
        if (url.includes('primary')) throw new Error('gone')
        return { bytes: Buffer.from('fallback-bytes'), contentType: 'image/jpeg' }
      }
      const report = await new MediaDownloader({ policy: policy(root), fetcher }).downloadAll(
        [item({ url: 'https://a/primary.jpg', fallbackUrls: ['https://a/fallback.jpg'] })],
      )
      expect(report.succeeded).toHaveLength(1)
      expect(tried).toEqual(['https://a/primary.jpg', 'https://a/fallback.jpg'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips complete files on rerun (resume semantics)', async () => {
    const root = await makeRoot()
    try {
      const dir = join(root, 'xhs', 'media', 'note-1')
      const { mkdir: mk } = await import('node:fs/promises')
      await mk(dir, { recursive: true })
      await writeFile(join(dir, 'note-1.jpg'), 'existing')
      let fetchCalls = 0
      const counting: MediaFetcher = async () => {
        fetchCalls += 1
        return { bytes: Buffer.from('x'), contentType: 'image/jpeg' }
      }
      await new MediaDownloader({ policy: policy(root), fetcher: counting }).downloadAll([item()])
      expect(fetchCalls).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('downloads split audio and merges for DASH items', async () => {
    const root = await makeRoot()
    try {
      const merges: Array<[string, string]> = []
      const merger = async (video: string, audio: string) => {
        merges.push([video, audio])
      }
      const report = await new MediaDownloader({
        policy: policy(root),
        fetcher: async () => ({ bytes: Buffer.from('track'), contentType: 'video/mp4' }),
        mergeDash: merger,
      }).downloadAll([item({ type: 'video', url: 'https://a/v.m4s', isDash: true, audioUrl: 'https://a/a.m4a' })])
      expect(report.succeeded).toHaveLength(1)
      expect(merges).toHaveLength(1)
      expect(merges[0][1]).toContain('.audio.m4a')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
