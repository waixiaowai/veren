/**
 * Print a session log's events.
 *
 * Session logs are zstd-compressed with one frame per durable append, so the
 * whole-file decompressor stops after the first frame; this walks the frame
 * magic instead. Optional second argument filters by event type.
 *
 * Usage: node scripts/dump-session.cjs <session.v4.jsonl.zstd> [eventType]
 * @module @local/startup-autostart/dump-session
 */
const { readFileSync } = require('node:fs')
const zlib = require('node:zlib')

const buf = readFileSync(process.argv[2])
const offsets = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
}
let text = ''
for (let f = 0; f < offsets.length; f++) {
  const start = offsets[f]
  const end = f + 1 < offsets.length ? offsets[f + 1] : buf.length
  try { text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8') } catch { /* torn tail frame */ }
}
const filter = process.argv[3]
console.log(`frames=${offsets.length}`)
for (const line of text.split('\n').filter(Boolean)) {
  const event = JSON.parse(line)
  if (filter !== undefined && event.type !== filter) continue
  console.log(String(event.seq), event.type, (JSON.stringify(event.data) ?? '').slice(0, 400))
}