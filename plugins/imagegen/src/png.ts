/**
 * 最小 PNG 编解码：只服务 chroma-key 透明化与 alpha 探针——解码 8-bit
 * RGB/RGBA 非隔行 PNG 为 RGBA 像素，编码 RGBA 像素为 PNG。不做缩放、
 * 不做调色板、不做 16-bit；超出面即响亮拒绝。
 * Minimal PNG codec: serves only chroma-key transparency and the alpha probe —
 * decodes 8-bit RGB/RGBA non-interlaced PNGs into RGBA pixels and encodes RGBA
 * pixels back. No scaling, no palettes, no 16-bit; anything beyond the face
 * is refused loudly.
 *
 * @module @veren/imagegen
 */
import { inflateSync, deflateSync } from 'node:zlib'

/** 解码结果：RGBA 像素与内在尺寸。The decode result: RGBA pixels plus intrinsic dimensions. */
export interface RasterImage {
  readonly width: number
  readonly height: number
  /** 长度恰为 width*height*4 的 RGBA 像素。RGBA pixels of exactly width*height*4. */
  readonly rgba: Uint8Array
}

/** PNG 文件签名。The PNG file signature. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const CRC_TABLE = buildCrcTable()

/** 构建 CRC32 查表（PNG chunk 校验和用）。Builds the CRC32 table (PNG chunk checksums). */
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

/** 计算一段字节的 CRC32。Computes the CRC32 of a byte range. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 读取 big-endian 无符号 32 位。Reads one big-endian uint32. */
function readU32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

/** 写入 big-endian 无符号 32 位。Writes one big-endian uint32. */
function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

/** PNG 反滤波的单像素重建（filter 0–4）。Single-pixel reconstruction for PNG filters 0–4. */
function reconByte(filter: number, raw: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0: return raw
    case 1: return raw + left
    case 2: return raw + up
    case 3: return raw + ((left + up) >> 1)
    case 4: {
      const p = left + up - upLeft
      const pa = Math.abs(p - left)
      const pb = Math.abs(p - up)
      const pc = Math.abs(p - upLeft)
      return raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
    }
    default: throw new Error(`png: unknown filter type ${filter}`)
  }
}

/** IHDR 头部字段。The IHDR header fields. */
interface PngHeader {
  readonly width: number
  readonly height: number
  readonly colorType: number
  readonly interlace: number
  readonly idatLength: number
}

/** 走完 chunk 序列：校验签名与 IHDR，拼接 IDAT 总长。 */
/** Walks the chunk sequence: validates the signature and IHDR, totals IDAT length. */
function parseChunks(data: Uint8Array): PngHeader {
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== SIGNATURE[i]) throw new Error('png: not a PNG file')
  }
  if (readU32(data, 8) !== 13) throw new Error('png: IHDR must be 13 bytes')
  const width = readU32(data, 16)
  const height = readU32(data, 20)
  const bitDepth = data[24]
  const colorType = data[25]
  const interlace = data[28]
  if (bitDepth !== 8) throw new Error(`png: unsupported bit depth ${bitDepth} (only 8)`)
  if (colorType !== 2 && colorType !== 6) throw new Error(`png: unsupported color type ${colorType} (only RGB/RGBA)`)
  if (interlace !== 0) throw new Error('png: interlaced PNG is not supported')
  let idatLength = 0
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = readU32(data, offset)
    const type = readU32(data, offset + 4)
    if (type === 0x49444154) idatLength += length // IDAT
    if (type === 0x49454e44) break // IEND
    offset += 12 + length
  }
  return { width, height, colorType, interlace, idatLength }
}

/** 解码 8-bit RGB/RGBA 非隔行 PNG 为 RGBA 像素。Decodes an 8-bit RGB/RGBA non-interlaced PNG into RGBA pixels. */
export function decodePng(data: Uint8Array): RasterImage {
  const header = parseChunks(data)
  const channels = header.colorType === 6 ? 4 : 3
  const stride = header.width * channels
  const compressed = extractIdat(data, header.idatLength)
  const raw = inflateSync(compressed)
  if (raw.length !== (stride + 1) * header.height) throw new Error('png: decompressed size mismatch')
  const rgba = new Uint8Array(header.width * header.height * 4)
  let previous = new Uint8Array(stride)
  let position = 0
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[position]
    position += 1
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      row[i] = reconByte(filter, raw[position + i], left, up, upLeft) & 0xff
    }
    position += stride
    expandRow(row, channels, rgba, y * header.width * 4)
    previous = row
  }
  return { width: header.width, height: header.height, rgba }
}

/** 拼接全部 IDAT 载荷。Concatenates every IDAT payload. */
function extractIdat(data: Uint8Array, totalLength: number): Uint8Array {
  const payload = new Uint8Array(totalLength)
  let filled = 0
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = readU32(data, offset)
    const type = readU32(data, offset + 4)
    if (type === 0x49444154) {
      payload.set(data.subarray(offset + 8, offset + 8 + length), filled)
      filled += length
    }
    if (type === 0x49454e44) break
    offset += 12 + length
  }
  return payload
}

/** 把一条已重建的源行扩成 RGBA 写进输出。Expands one reconstructed source row into RGBA in the output. */
function expandRow(row: Uint8Array, channels: number, rgba: Uint8Array, outOffset: number): void {
  const pixels = row.length / channels
  for (let x = 0; x < pixels; x += 1) {
    const source = x * channels
    const target = outOffset + x * 4
    rgba[target] = row[source]
    rgba[target + 1] = row[source + 1]
    rgba[target + 2] = row[source + 2]
    rgba[target + 3] = channels === 4 ? row[source + 3] : 255
  }
}

/** 组装一个 PNG chunk（长度 + 类型 + 载荷 + CRC）。Assembles one PNG chunk (length, type, payload, CRC). */
function writeChunk(target: Uint8Array, offset: number, type: string, payload: Uint8Array): number {
  writeU32(target, offset, payload.length)
  for (let i = 0; i < 4; i += 1) target[offset + 4 + i] = type.charCodeAt(i)
  target.set(payload, offset + 8)
  const body = target.subarray(offset + 4, offset + 8 + payload.length)
  writeU32(target, offset + 8 + payload.length, crc32(body))
  return offset + 12 + payload.length
}

/** 编码 RGBA 像素为 8-bit RGBA PNG（逐行 filter 0）。Encodes RGBA pixels as an 8-bit RGBA PNG (filter 0 per row). */
export function encodePng(image: RasterImage): Uint8Array {
  const stride = image.width * 4
  const raw = new Uint8Array((stride + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0
    raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  writeU32(ihdr, 0, image.width)
  writeU32(ihdr, 4, image.height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const compressed = deflateSync(raw)
  const total = 8 + (25 + 12 + 13) + compressed.length
  const out = new Uint8Array(total)
  out.set(SIGNATURE)
  let offset = 8
  offset = writeChunk(out, offset, 'IHDR', ihdr)
  offset = writeChunk(out, offset, 'IDAT', compressed)
  writeChunk(out, offset, 'IEND', new Uint8Array(0))
  return out
}
