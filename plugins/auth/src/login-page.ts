/**
 * The public login page: a single self-contained HTML document styled after
 * the dsh Web shell (flat surfaces, boot background `#fff` / `#151517`,
 * Montserrat-first stack, the DeepSeek blue accent). It posts to Better
 * Auth's `/auth/sign-in/email`, never reveals whether the account or the
 * password failed, and offers sign-out for an already-authenticated browser.
 * Inline style/script keeps the page free of SPA assets so it loads before
 * any authentication exists.
 * 公开登录页：单个自包含 HTML 文档，视觉沿用 dsh Web 外壳风格（平面、启动背景
 * `#fff` / `#151517`、Montserrat 优先字体栈、DeepSeek 蓝色强调色）。表单提交到
 * Better Auth 的 `/auth/sign-in/email`，不区分账号不存在与密码错误，并为已
 * 登录浏览器提供登出入口。内联样式/脚本使页面不依赖任何 SPA 资源，可在未
 * 认证时加载。
 * @module src/login-page
 */

/**
 * Render the login page. Every request the page makes is same-origin
 * relative, so the listener's origin never appears in the document — a
 * browser may reach the listener through `127.0.0.1`, `localhost`, or any
 * authority without tripping CORS.
 * 渲染登录页。页面的所有请求都是同源相对路径，文档中绝不出现监听器 origin
 * ——浏览器经 `127.0.0.1`、`localhost` 或任何 authority 访问都不会触发 CORS。
 * @returns the full HTML document.
 */
export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh Web · Sign in / 登录</title>
<style>
  :root {
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
  * { box-sizing: border-box; }
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
  label { display: grid; gap: 6px; font-size: 12px; color: var(--text-dim); margin-bottom: 16px; }
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
  button {
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
  .error {
    color: var(--danger);
    font-size: 12px;
    min-height: 18px;
    margin: 10px 0 0;
    text-align: center;
  }
  [hidden] { display: none !important; }
  #who { text-align: center; color: var(--text-dim); font-size: 13px; margin: 0 0 20px; overflow-wrap: anywhere; }
  footer { text-align: center; color: var(--text-dim); font-size: 11px; margin-top: 16px; }
</style>
</head>
<body>
<main>
  <section class="card">
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

    <section id="signedin" hidden>
      <p id="who"></p>
      <button class="primary" id="enter" type="button">Enter / 进入</button>
      <button class="secondary" id="signout" type="button">Sign out / 登出</button>
    </section>
  </section>
  <footer>DeepSeek Harness</footer>
</main>
<script>
const form = document.getElementById('signin');
const panel = document.getElementById('signedin');
const error = document.getElementById('error');
const submit = document.getElementById('submit');

async function session() {
  const res = await fetch('/auth/get-session', { credentials: 'same-origin' });
  return res.ok ? res.json() : null;
}

// An authenticated browser may enter directly or sign out; a fresh one sees
// the form. ANY failure of the probe (blocked request, proxy error, offline)
// fails open to the form — a blank card must be impossible.
// 已认证浏览器可直接进入或登出；未认证浏览器看到表单。探测的任何失败（请求
// 被拦截、代理错误、离线）都兜底显示表单——页面绝不停留在空白卡片。
function showForm() {
  form.hidden = false;
  const first = form.querySelector('input');
  if (first !== null) first.focus();
}

session().then(data => {
  if (data && data.user) {
    document.getElementById('who').textContent = data.user.email || data.user.name || '';
    panel.hidden = false;
  } else {
    showForm();
  }
}).catch(showForm);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  const data = new FormData(form);
  let res;
  try {
    res = await fetch('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
    });
  } finally {
    submit.disabled = false;
  }
  // One message for every failure: the page never says which field was wrong.
  // 所有失败共用一句话：页面不透露具体错在哪个字段。
  if (!res.ok) { error.textContent = 'Sign in failed / 登录失败'; return; }
  submit.disabled = true;
  location.href = '/';
});

document.getElementById('enter').addEventListener('click', () => { location.href = '/'; });
document.getElementById('signout').addEventListener('click', async () => {
  await fetch('/auth/sign-out', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: '{}',
  });
  location.href = '/login';
});
</script>
</body>
</html>
`
}
