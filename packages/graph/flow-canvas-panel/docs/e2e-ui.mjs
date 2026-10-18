/**
 * Headless UI walkthrough for the Flow canvas panel.
 *
 * Runs the real Web GUI in an isolated test node (its own DSH_HOME and port),
 * drives the operator path "select flow -> run -> watch approval -> allow ->
 * inspect output", and captures 1440x900 screenshots for the before/after
 * comparison. The script is verification-only; it never writes to ~/.dsh.
 *
 * 画布面板的无头 UI 走查：在隔离测试节点（自有 DSH_HOME 与端口）运行真实 Web GUI，
 * 走一遍“选流程 → 运行 → 等待授权 → 同意 → 查看输出”，并截取 1440x900 的前后对比图。
 * 本脚本只做验证，绝不写 ~/.dsh。
 *
 * Usage:
 *   node docs/e2e-ui.mjs <url> before|after [outputDir]
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
const outDir = resolve(process.argv[4] ?? join(here, 'ui-shots'))
if (url === undefined) throw new Error('usage: node docs/e2e-ui.mjs <url> before|after [outputDir]')
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
const waitForBody = async (needle, timeoutMs = 25_000) => {
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
            await page.waitForTimeout(400)
        }
    }
}
const openPanel = async () => {
    await clickAny(['继续', '知道了', '开始使用', '跳过', '关闭', 'Got it', 'Continue', 'Start'])
    const entry = page.getByRole('button', { name: /Flow 画布|流程画布/ })
    if (await entry.count() > 0) await entry.first().click()
    else await page.getByText(/Flow 画布|流程画布/, { exact: true }).first().click()
    await page.waitForTimeout(1200)
}
const selectFlow = async (flowId) => {
    await page.selectOption('#flow-canvas-select', flowId)
    await page.waitForTimeout(800)
}
const run = async () => {
    const button = page.getByRole('button', { name: /^(运行|再次运行|Run)$/ })
    await button.first().click()
}

try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(4000)
    await openPanel()
    log('title', await page.locator('h1').first().innerText())
    log('flows', await page.locator('#flow-canvas-select option').allInnerTexts())
    await shot('panel-initial')

    // 0) Pan / zoom / fit, driven through the real controls and real pointer
    // events. The percentage must change and fit must restore the initial view.
    const zoomValue = page.getByRole('button', { name: '重置为 100%' })
    const initialZoom = await zoomValue.innerText()
    await page.getByRole('button', { name: '放大' }).click()
    await page.waitForTimeout(250)
    const zoomed = await zoomValue.innerText()
    await shot('zoom-in')
    await page.getByRole('button', { name: '重置为 100%' }).click()
    await page.waitForTimeout(250)
    const resetZoom = await zoomValue.innerText()
    await shot('zoom-100')
    await page.getByRole('button', { name: '适应屏幕' }).click()
    await page.waitForTimeout(250)
    const fitted = await zoomValue.innerText()
    log('zoom', { initialZoom, zoomed, resetZoom, fitted })
    if (initialZoom === zoomed) throw new Error('zoom-in did not change the percentage')
    if (resetZoom !== '100%') throw new Error(`reset did not reach 100% (got ${resetZoom})`)
    if (fitted !== initialZoom) throw new Error(`fit did not restore ${initialZoom} (got ${fitted})`)
    const viewport = page.locator('div[aria-label="流程画布"]').first()
    const canvasBox = await viewport.boundingBox()
    if (canvasBox !== null) {
        await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 80)
        await page.mouse.down()
        await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 90, canvasBox.y + 110, { steps: 5 })
        await page.mouse.up()
        await page.waitForTimeout(200)
        await page.getByRole('button', { name: '适应屏幕' }).click()
    }
    await shot('zoom-fit')

    // 1) The run path: a paced demo that visibly transitions through running.
    await selectFlow('canvas-demo-pacing')
    await run()
    await waitForBody('运行中')
    await shot('running')
    await waitForBody(/失败 1|1 个节点失败/, 30_000)
    await page.waitForTimeout(800)
    await shot('settled')
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    await page.waitForTimeout(400)
    await shot('dark-settled')
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /兜底分支/ }).first().click()
    await page.waitForTimeout(600)
    await shot('output')
    log('settled-body', (await body()).slice(0, 500))

    // 2) The approval path: a real tool suspension answered by a human.
    await selectFlow('approval-explicit')
    await run()
    const card = page.getByRole('group', { name: '节点授权' })
    await card.waitFor({ state: 'visible', timeout: 20_000 })
    log('approval-card', await card.innerText())
    await shot('approval-card')
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    await page.waitForTimeout(400)
    await shot('dark-approval')
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    await page.waitForTimeout(200)
    await card.getByRole('button', { name: '同意' }).click()
    await waitForBody(/由 .* 同意/)
    await page.waitForTimeout(1200)
    await shot('approval-approved')
    await page.getByRole('button', { name: /gate/ }).first().click()
    await page.waitForTimeout(600)
    await shot('approval-output')
    log('approved-body', (await body()).slice(-600))

    // 3) Reload recovery: refresh while an approval is still pending, then
    // re-open the panel and finish the same run without starting a new one.
    await selectFlow('approval-explicit')
    await run()
    const beforeReload = page.getByRole('group', { name: '节点授权' })
    await beforeReload.waitFor({ state: 'visible', timeout: 20_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await openPanel()
    const resumed = page.getByRole('group', { name: '节点授权' })
    await resumed.waitFor({ state: 'visible', timeout: 20_000 })
    await shot('reload-resumed')
    log('reload-card', await resumed.innerText())
    await resumed.getByRole('button', { name: '同意' }).click()
    await waitForBody(/运行完成|由 .* 同意/, 25_000)
    await page.waitForTimeout(800)
    await shot('reload-finished')
    log('reload-body', (await body()).slice(0, 500))

    log('done', 'walkthrough complete')
} finally {
    await browser.close()
}
