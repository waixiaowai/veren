/**
 * Border/contrast walkthrough for the node cards.
 *
 * Captures the same graph at fit (~82%) and 100% in light and dark themes,
 * plus selected and hover states, and logs the computed border/shadow tokens.
 * Used before/after the card-outline change; verification only.
 *
 * 节点卡片边界/对比度走查：同一张图在浅色/深色、适应屏幕（约 82%）与 100% 下截图，
 * 另加选中态和 hover 态，并记录计算后的描边/阴影 token。用于边界改动前后对比，只做验证。
 *
 * Usage:
 *   node docs/e2e-borders.mjs <url> before|after [outputDir]
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const harness = resolve(here, '../../../../deepseek/deepseek-harness')
const require = createRequire(join(harness, 'apps/web/package.json'))
let chromium
try {
    ({ chromium } = require('playwright'))
} catch {
    const fallback = join(harness, 'node_modules/.pnpm/playwright@1.61.1/node_modules/playwright')
    ;({ chromium } = createRequire(join(fallback, 'package.json'))(fallback))
}

const url = process.argv[2]
const phase = process.argv[3] === 'before' ? 'before' : 'after'
const outDir = resolve(process.argv[4] ?? join(here, 'border-shots'))
if (url === undefined) throw new Error('usage: node docs/e2e-borders.mjs <url> before|after [outputDir]')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(30_000)
const shot = async (name) => { await page.screenshot({ path: join(outDir, `${phase}-${name}.png`) }) }
const log = (label, value) => console.log(`[${phase}:${label}]`, value)
const body = async () => page.locator('body').innerText()
const waitForBody = async (needle, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const text = await body()
        const hit = needle instanceof RegExp ? needle.test(text) : text.includes(needle)
        if (hit) return
        await page.waitForTimeout(200)
    }
    throw new Error(`body never contained: ${needle}\n${await body()}`)
}
const clickAny = async (labels) => {
    for (const label of labels) {
        const button = page.getByRole('button', { name: label })
        if (await button.count() > 0) {
            await button.first().click().catch(() => {})
            await page.waitForTimeout(300)
        }
    }
}
const openPanel = async () => {
    await clickAny(['继续', '知道了', '开始使用', '跳过', '关闭', 'Got it', 'Continue', 'Start'])
    const entry = page.getByRole('button', { name: /Flow 画布|流程画布/ })
    if (await entry.count() > 0) await entry.first().click()
    else await page.getByText(/Flow 画布|流程画布/, { exact: true }).first().click()
    await page.waitForTimeout(1000)
}
const setDark = async (dark) => {
    await page.evaluate((enabled) => {
        if (enabled) document.body.setAttribute('data-ds-dark-theme', '')
        else document.body.removeAttribute('data-ds-dark-theme')
    }, dark)
    await page.waitForTimeout(300)
}
const cardStyles = async (nodeId) => page.evaluate((id) => {
    const card = document.querySelector(`[data-flow-node-card="${id}"]`)
    if (!(card instanceof HTMLElement)) return null
    const style = getComputedStyle(card)
    return {
        border: style.border,
        borderWidth: style.borderWidth,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        background: style.backgroundColor,
        outline: style.outline,
    }
}, nodeId)
const zoomText = async () => page.getByRole('button', { name: '重置为 100%' }).innerText()

try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(4000)
    await openPanel()

    // One paced run gives completed / recovered / failed / skipped cards at once.
    await page.selectOption('#flow-canvas-select', 'canvas-demo-pacing')
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: /^(运行|再次运行)$/ }).first().click()
    await waitForBody(/1 个节点失败|失败 1/, 35_000)
    await page.waitForTimeout(900)

    // Fit = the real default view (~82% for the six-node graph).
    await page.getByRole('button', { name: '适应屏幕' }).click()
    await page.waitForTimeout(400)
    log('fit-zoom', await zoomText())
    log('fit-styles', { gate: await cardStyles('gate'), fatal: await cardStyles('fatal') })
    await shot('82-light')

    // 100% in light.
    await page.getByRole('button', { name: '重置为 100%' }).click()
    await page.waitForTimeout(400)
    log('100-zoom', await zoomText())
    log('100-styles', { gate: await cardStyles('gate'), fatal: await cardStyles('fatal') })
    await shot('100-light')

    // 100% and fit in dark.
    await setDark(true)
    await shot('100-dark')
    await page.getByRole('button', { name: '适应屏幕' }).click()
    await page.waitForTimeout(400)
    log('dark-fit-styles', { gate: await cardStyles('gate'), fatal: await cardStyles('fatal') })
    await shot('82-dark')
    await setDark(false)
    await page.getByRole('button', { name: '适应屏幕' }).click()
    await page.waitForTimeout(400)

    // Selected state: click the recovered gate.
    await page.getByRole('button', { name: /兜底分支/ }).first().click()
    await page.waitForTimeout(500)
    log('selected-style', await cardStyles('gate'))
    await shot('selected-light')
    await page.getByRole('button', { name: '关闭详情' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '适应屏幕' }).click()
    await page.waitForTimeout(300)

    // Hover state: the failed fatal card.
    await page.getByRole('button', { name: /致命分支/ }).first().hover()
    await page.waitForTimeout(400)
    log('hover-style', await cardStyles('fatal'))
    await shot('hover-light')

    // Hover in dark as well.
    await setDark(true)
    await page.getByRole('button', { name: /致命分支/ }).first().hover()
    await page.waitForTimeout(300)
    await shot('hover-dark')
    await setDark(false)

    log('done', 'border walkthrough complete')
} finally {
    await browser.close()
}
