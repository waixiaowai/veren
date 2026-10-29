/**
 * 会话日志的多帧 zstd 解码。
 * Multi-frame zstd decoding of session logs.
 *
 * 会话日志按批追加，压缩器每批写一个独立 zstd 帧；单次 `zstdDecompressSync` 只解第一帧，
 * 因此必须按帧头结构切分（算法与 `packages/session/session-persistence-jsonl/src/zstd.ts`
 * 的 `scanZstdFrames` 一致，此处内联以免本脚本依赖构建产物）。
 * Session logs are appended in batches and the compressor writes one independent zstd
 * frame per batch; a single `zstdDecompressSync` call yields only the first frame, so
 * frames must be split structurally (the same algorithm as `scanZstdFrames` in
 * `packages/session/session-persistence-jsonl/src/zstd.ts`, inlined so this script needs
 * no build artifacts).
 *
 * @module @veren/scripts/audit/zstd-frames
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/** zstd 帧头 magic（小端序）/ the frame-header magic, little-endian */
const ZSTD_MAGIC = 0xfd2fb528

/**
 * 按帧头结构切出完整帧的字节区间；末尾残缺帧丢弃。
 * Split out the byte ranges of complete frames; a torn tail is dropped.
 * @param buffer - 会话日志的完整字节 / the whole session-log artifact
 * @returns 每帧的 `[start, end)` 区间 / one `[start, end)` range per complete frame
 */
export function scanFrameRanges(buffer) {
  const ranges = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset >= buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (offset + 3 > buffer.length) return ranges
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      offset += blockType === 0x01 ? 1 : blockHeader >>> 3
      if (offset > buffer.length) return ranges
      if (lastBlock) break
    }
    if (checksum) offset += 4
    if (offset > buffer.length) return ranges
    ranges.push({ start, end: offset })
  }
  return ranges
}

/**
 * 解出会话日志的全部事件（跨帧撕裂的行按坏行丢弃）。
 * Decode every event of a session log, dropping lines torn across frames.
 * @param file - `session.v*.jsonl.zstd` 路径 / path to the zstd log
 * @returns 事件对象数组 / the parsed events
 */
export function readEvents(file) {
  const buffer = readFileSync(file)
  const events = []
  for (const { start, end } of scanFrameRanges(buffer)) {
    const text = zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      try { events.push(JSON.parse(line)) } catch { /* 坏行丢弃：下一行仍可读 / drop the bad line and keep going */ }
    }
  }
  return events
}
