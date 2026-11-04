import { describe, expect, it, vi } from 'vitest'
import { MediaCompanionSink, toMediaItems } from '../src/media/companion.ts'
import type { DataSink, RawItem } from '../src/crawler/contract.ts'
import type { MediaItem } from '../src/media/downloader.ts'

// 媒体伴随验收（SYS-04）：内容先落库再串行下载；下载失败不影响落库。
// Media-companion acceptance (SYS-04): content persists first, then serial
// downloads; a download failure never breaks persistence.
function itemWithMedia(): RawItem {
  return {
    id: 'n1', title: null, desc: null, url: 'u', publishTime: null,
    likedCount: null, commentCount: null, collectedCount: null, shareCount: null,
    imageList: ['https://cdn/a.jpg', 'https://cdn/b.jpg'], videoUrl: 'https://cdn/v.mp4',
    tagList: [], creatorId: 'u', nickname: '张*',
  }
}

describe('toMediaItems', () => {
  it('derives image and video media items from a raw item', () => {
    const items = toMediaItems(itemWithMedia())
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ url: 'https://cdn/a.jpg', type: 'image', contentId: 'n1' })
    expect(items[2]).toMatchObject({ url: 'https://cdn/v.mp4', type: 'video' })
    expect(toMediaItems({ ...itemWithMedia(), imageList: [], videoUrl: null })).toHaveLength(0)
  })
})

describe('MediaCompanionSink', () => {
  it('persists content first, then downloads its media serially', async () => {
    const order: string[] = []
    const inner: DataSink = {
      content: async () => {
        order.push('persist')
      },
      comment: async () => {},
    }
    const downloadAll = vi.fn(async (items: MediaItem[]) => ({ succeeded: items, failed: [] as Array<{ item: MediaItem; reason: string }> }))
    const sink = new MediaCompanionSink(inner, { downloadAll } as never)
    await sink.content(itemWithMedia())
    expect(order).toEqual(['persist'])
    expect(downloadAll).toHaveBeenCalledTimes(1)
    const items = downloadAll.mock.calls[0]?.[0] as readonly unknown[]
    expect(items).toHaveLength(3)
  })
})
