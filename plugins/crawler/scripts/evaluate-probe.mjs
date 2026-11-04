// evaluate 通道真机探针：连 CDP Chrome → 打开页面 → 页面内执行 JS
// （验证签名脚本引擎通道在真实浏览器环境里可用）。
// The evaluate-channel probe: connects to CDP Chrome, opens a page, runs
// in-page JS (verifying the signing-script engine channel works in a real
// browser environment).
import { chromium as playwrightChromium } from 'playwright-core'

const browser = await playwrightChromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
if (context === undefined) {
  console.log('FAIL: no context')
  process.exit(1)
}
const page = context.pages()[0] ?? await context.newPage()

// 1) 简单表达式：确认 evaluate 通道 / simple expression: confirms the channel
const arithmetic = await page.evaluate('1 + 2')

// 2) DOM 读取：确认页面环境可用 / dom read: confirms the page environment
await page.goto('https://tieba.baidu.com/', { waitUntil: 'domcontentloaded' })
const pageTitle = await page.evaluate('document.title')

// 3) 签名脚本模拟：函数调用返回字符串（模拟 x-s / x-zse-96 类签名产出）
//    signing-script simulation: a function call returning a string (like x-s / x-zse-96)
const simulatedSign = await page.evaluate(`(() => { const t = Date.now().toString(); return t.slice(-8) })()`)

console.log(`arithmetic(1+2)=${arithmetic}`)
console.log(`tieba-title=${String(pageTitle).slice(0, 30)}`)
console.log(`simulated-sign=${simulatedSign} (type=${typeof simulatedSign})`)
const ok = Number(arithmetic) === 3 && typeof simulatedSign === 'string' && simulatedSign.length === 8
console.log(ok ? 'EVALUATE-CHANNEL OK' : 'EVALUATE-CHANNEL FAIL')
process.exit(ok ? 0 : 1)
