#!/usr/bin/env node
/**
 * One-time migration: push a device's local IM directory into the CMS hub
 * (data-home ADR row 4). Dry-run by default — `--apply` performs the import.
 *
 * Curation rules (documented in docs/im-control-plane.cn.md §设备侧改造):
 *   1. Only people with at least one address are importable — an address-less
 *      identity cannot be addressed cross-device.
 *   2. Entries dedupe by external_id; an entry carrying a self-reported claim
 *      wins over a raw-id duplicate (the local hub-channel copy of the same
 *      human must not clobber the curated name).
 *   3. The import upserts idempotently on the hub (provider, external_id), so
 *      re-running is always safe.
 *
 * 一次性迁移：把设备的本地 IM 目录推上 CMS 云端（归属表第 4 行）。默认 dry-run，
 * `--apply` 才真正导入。
 *
 * 策展规则（docs/im-control-plane.cn.md §设备侧改造）：
 *   1. 只有带地址的人可导入——无地址的身份无法跨设备寻址；
 *   2. 按 external_id 去重；带自称（claim）的条目优先于原 id 副本（同一人的
 *      hub 通道本地副本不得冲掉策展名）；
 *   3. 云端按 (provider, external_id) 幂等 upsert，重复执行安全。
 *
 * Usage / 用法:
 *   node scripts/import-im-directory.mjs [--apply]
 *     [--store <im.json path>] [--cms <origin>] [--channel hub]
 *     [--email <email>] [--password <pass>]
 *
 * @module @veren/scripts/import-im-directory
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const option = name => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const storePath = option('store') ?? 'deepseek/.dsh/storages/im.json'
const cms = (option('cms') ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
const email = option('email') ?? process.env.CMS_EMAIL
const password = option('password') ?? process.env.CMS_PASSWORD
// 迁移即换轨：条目落到活通道（默认 hub）。通道换轨时人跟人，external_id 不变。
// Migration re-tracks the channel: entries land on the live channel (hub by
// default) — the channel changed under the same human, external_id is stable.
const channel = option('channel') ?? 'hub'

const im = JSON.parse(readFileSync(storePath, 'utf8'))
const people = Object.values(im.tables.people ?? {})
const addresses = Object.values(im.tables.person_addresses ?? {})

// ① 只有带地址的人可导入；② external_id 去重，带 claim 者优先。
const byExternal = new Map()
const skipped = []
for (const person of people) {
  const address = addresses.find(entry => entry.person_id === person.id)
  if (address === undefined) {
    skipped.push(`${person.display_name}（无地址，留在设备侧）`)
    continue
  }
  const entry = {
    provider: channel,
    external_id: address.external_id,
    display_name: person.claim?.name ?? person.display_name,
    claimed_name: person.claim?.name ?? '',
    identity_status: person.claim ? 'self-reported' : 'self-reported',
    note: person.notes ?? '',
  }
  const existing = byExternal.get(entry.external_id)
  if (existing === undefined || (entry.claimed_name !== '' && existing.claimed_name === '')) {
    byExternal.set(entry.external_id, entry)
  }
}
const persons = [...byExternal.values()]

console.log(`本地目录：${people.length} 人 / ${addresses.length} 地址`)
for (const reason of skipped) console.log(`  跳过：${reason}`)
console.log(`计划导入 ${persons.length} 条：`)
for (const entry of persons) {
  console.log(`  ${entry.provider}/${entry.external_id} → "${entry.display_name}"` +
    (entry.claimed_name ? `（自称：${entry.claimed_name}）` : ''))
}

if (!apply) {
  console.log('\n[dry-run] 未执行导入；加 --apply 执行。')
  process.exit(0)
}
if (email === undefined || password === undefined) {
  console.error('[apply] 需要 --email/--password 或 CMS_EMAIL/CMS_PASSWORD 环境变量')
  process.exit(1)
}

// 登录换 JWT（跨源管理面凭据轨），再走管理面批量导入。
const login = await fetch(`${cms}/v1/auth/jwt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const loginBody = await login.json()
if (loginBody.code !== 0) {
  console.error(`[apply] 登录失败: ${loginBody.message}`)
  process.exit(1)
}
const token = loginBody.data.access_token

const response = await fetch(`${cms}/v1/im/hub/people/import`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ persons }),
})
const body = await response.json()
if (body.code !== 0) {
  console.error(`[apply] 导入失败: ${body.message}`)
  process.exit(1)
}
console.log(`\n[apply] 导入完成：${body.data.imported} 条。`)
