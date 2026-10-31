/**
 * Body markup fragment of the login page: the sign-in card with its form,
 * the no-JavaScript fallback, and the signed-in panel (identity line plus
 * enter/sign-out actions). Helpers return raw HTML lines ending in a newline;
 * concatenating them reproduces the original markup byte for byte.
 * 登录页正文标记片段：带表单的登录卡片、无 JavaScript 兜底，以及已登录面板
 * （身份行与进入/登出按钮）。辅助函数返回以换行结尾的原始 HTML 行；按序
 * 拼接即可逐字节复现原先的标记。
 * @module src/login-page-body
 */

/**
 * The sign-in card: branding, hint, the email+password form and the
 * no-JavaScript fallback message.
 * 登录卡片：品牌区、提示语、邮箱+密码表单与无 JavaScript 兜底提示。
 * @returns HTML text ending in a newline. 以换行结尾的 HTML 文本。
 */
function loginBodyForm(): string {
  return `  <section class="card">
    <div class="brand"><h1>dsh Web</h1><small>DeepSeek Harness</small></div>
    <p class="hint">Sign in to continue / 登录后继续</p>

    <form id="signin">
      <label>Email / 用户名邮箱
        <input name="email" type="text" autocomplete="username" required autofocus
               placeholder="you@example.com">
      </label>
      <label>Password / 密码
        <input name="password" type="password" autocomplete="current-password" required
               placeholder="••••••••">
      </label>
      <button class="primary" type="submit" id="submit">Sign in / 登录</button>
      <output class="error" id="error" role="alert"></output>
    </form>
    <noscript>
      <p class="error">JavaScript is required for sign-in / 登录需要启用 JavaScript</p>
    </noscript>

`
}

/**
 * The signed-in panel: identity line with enter/sign-out actions, closing
 * the card, plus the page footer.
 * 已登录面板：身份行与进入/登出按钮（并闭合卡片），外加页脚。
 * @returns HTML text ending in a newline. 以换行结尾的 HTML 文本。
 */
function loginBodySignedIn(): string {
  return `    <section id="signedin" hidden>
      <p id="who"></p>
      <button class="primary" id="enter" type="button">Enter / 进入</button>
      <button class="secondary" id="signout" type="button">Sign out / 登出</button>
    </section>
  </section>
  <footer>DeepSeek Harness</footer>
`
}

/**
 * Compose the `<body>` content: the card markup between the `<body>`/`<main>`
 * openers and the closing `</main>`. The `</body>` tag belongs to the script
 * fragment so the original byte order (`</script>` before `</body>`) holds.
 * 组装 `<body>` 内容：卡片标记夹在 `<body>`/`<main>` 开标签与闭合 `</main>`
 * 之间。`</body>` 归脚本片段负责，以保持原始字节顺序（`</script>` 在
 * `</body>` 之前）。
 * @returns the body text ending in a newline. 以换行结尾的正文文本。
 */
export function renderLoginBody(): string {
  return `<body>
<main>
${loginBodyForm()}${loginBodySignedIn()}</main>
`
}
