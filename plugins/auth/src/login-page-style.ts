/**
 * Stylesheet fragment of the login page: design tokens, layout primitives and
 * component rules, all inline so the page loads before any authentication or
 * SPA asset exists. Every helper returns raw CSS text ending in a newline;
 * concatenating them reproduces the original single stylesheet byte for byte.
 * 登录页样式片段：设计令牌、布局原语与组件规则，全部内联，使页面可在任何
 * 认证或 SPA 资源之前加载。每个辅助函数返回以换行结尾的原始 CSS 文本；按序
 * 拼接即可逐字节复现原先的单一样式表。
 * @module src/login-page-style
 */

/**
 * Color-scheme tokens for light and dark. 亮/暗两套配色令牌。
 * @returns CSS text ending in a newline. 以换行结尾的 CSS 文本。
 */
function loginStyleTokens(): string {
  return `  :root {
    color-scheme: light dark;
    --bg: #fff;
    --panel: #fff;
    --text: #0f1115;
    --text-dim: #5f6368;
    --border: #e8eaed;
    --field-bg: #f9fafb;
    --accent: #1c00cf;
    --accent-text: #fff;
    --danger: #c5221f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #151517;
      --panel: #202124;
      --text: #e8eaed;
      --text-dim: #9aa0a6;
      --border: #3c4043;
      --field-bg: #2a2b2f;
      --accent: #99c8ff;
      --accent-text: #0f1115;
      --danger: #f28b82;
    }
  }
`
}

/**
 * Page layout: resets, the centering grid body, the card shell and branding.
 * 页面布局：重置、居中网格 body、卡片外壳与品牌区。
 * @returns CSS text ending in a newline. 以换行结尾的 CSS 文本。
 */
function loginStyleLayout(): string {
  return `  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--text);
    font-family: 'Montserrat', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  main { width: min(360px, 92vw); }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px 28px 28px;
  }
  .brand { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .brand h1 { font-size: 18px; font-weight: 700; letter-spacing: .01em; margin: 0; }
  .brand small { color: var(--text-dim); font-size: 12px; }
  .hint { color: var(--text-dim); font-size: 12px; margin: 0 0 24px; }
`
}

/**
 * Form field rules: labels and text inputs with focus feedback.
 * 表单字段规则：label 与文本输入框（含聚焦反馈）。
 * @returns CSS text ending in a newline. 以换行结尾的 CSS 文本。
 */
function loginStyleFields(): string {
  return `  label { display: grid; gap: 6px; font-size: 12px; color: var(--text-dim); margin-bottom: 16px; }
  input {
    font: inherit;
    color: var(--text);
    background: var(--field-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    outline: none;
    transition: border-color .15s ease;
    width: 100%;
  }
  input:focus { border-color: var(--accent); }
  input::placeholder { color: var(--text-dim); opacity: .7; }
`
}

/**
 * Button rules: the primary submit and the secondary sign-out actions.
 * 按钮规则：主提交按钮与次级登出按钮。
 * @returns CSS text ending in a newline. 以换行结尾的 CSS 文本。
 */
function loginStyleButtons(): string {
  return `  button {
    font: inherit;
    font-weight: 600;
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: opacity .15s ease, background .15s ease;
  }
  button[disabled] { opacity: .6; cursor: default; }
  .primary { background: var(--accent); color: var(--accent-text); margin-top: 4px; }
  .primary:not([disabled]):hover { opacity: .9; }
  .secondary {
    background: transparent;
    color: var(--text);
    border-color: var(--border);
    margin-top: 10px;
  }
  .secondary:not([disabled]):hover { background: var(--field-bg); }
`
}

/**
 * Auxiliary rules: the error line, the hidden-attribute guard, the
 * signed-in identity line and the footer.
 * 辅助规则：错误行、hidden 属性守卫、已登录身份行与页脚。
 * @returns CSS text ending in a newline. 以换行结尾的 CSS 文本。
 */
function loginStyleAux(): string {
  return `  .error {
    color: var(--danger);
    font-size: 12px;
    min-height: 18px;
    margin: 10px 0 0;
    text-align: center;
  }
  [hidden] { display: none !important; }
  #who { text-align: center; color: var(--text-dim); font-size: 13px; margin: 0 0 20px; overflow-wrap: anywhere; }
  footer { text-align: center; color: var(--text-dim); font-size: 11px; margin-top: 16px; }
`
}

/**
 * Compose the full inline stylesheet from the section fragments, in the
 * original declaration order.
 * 按原始声明顺序把各段样式拼成完整的内联样式表。
 * @returns the `<style>` element text ending in a newline. 以换行结尾的 `<style>` 元素文本。
 */
export function renderLoginStyle(): string {
  return `<style>
${loginStyleTokens()}${loginStyleLayout()}${loginStyleFields()}${loginStyleButtons()}${loginStyleAux()}</style>
`
}
