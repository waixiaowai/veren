/**
 * The public login page: a single self-contained HTML document. It posts to
 * Better Auth's `/auth/sign-in/email`, never reveals whether the account or
 * the password failed, and offers sign-out for an already-authenticated
 * browser. Inline style/script keeps the page free of SPA assets so it loads
 * before any authentication exists.
 * 公开登录页：单个自包含 HTML 文档。表单提交到 Better Auth 的
 * `/auth/sign-in/email`，不区分账号不存在与密码错误，并为已登录浏览器提供
 * 登出入口。内联样式/脚本使页面不依赖任何 SPA 资源，可在未认证时加载。
 * @module src/login-page
 */

/** Escape one text value for safe HTML interpolation. 转义文本值以便安全插入 HTML。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Render the login page.
 * @param origin - The listener origin the page talks to (same origin by construction).
 * @returns the full HTML document.
 */
export function renderLoginPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh · Sign in / 登录</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form, section { width: min(22rem, 90vw); display: grid; gap: .75rem;
    padding: 2rem; border-radius: .75rem;
    background: canvas; color: canvastext;
    box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  label { display: grid; gap: .25rem; font-size: .875rem; }
  input, button { font: inherit; padding: .5rem .75rem; border-radius: .5rem;
    border: 1px solid color-mix(in srgb, canvastext 25%, transparent); }
  button { cursor: pointer; }
  #error { color: canvastext; opacity: .75; font-size: .875rem; min-height: 1em; }
</style>
</head>
<body>
<form id="signin" hidden>
  <h2>dsh Web</h2>
  <label>Email / 用户名邮箱
    <input name="email" type="text" autocomplete="username" required autofocus>
  </label>
  <label>Password / 密码
    <input name="password" type="password" autocomplete="current-password" required>
  </label>
  <button type="submit">Sign in / 登录</button>
  <output id="error" role="alert"></output>
</form>
<section id="signedin" hidden>
  <h2>dsh Web</h2>
  <p id="who"></p>
  <button id="enter">Enter / 进入</button>
  <button id="signout">Sign out / 登出</button>
</section>
<script>
const ORIGIN = ${JSON.stringify(escapeHtml(origin))};
const form = document.getElementById('signin');
const panel = document.getElementById('signedin');
const error = document.getElementById('error');

async function session() {
  const res = await fetch(ORIGIN + '/auth/get-session', { credentials: 'same-origin' });
  return res.ok ? res.json() : null;
}

// An authenticated browser may enter directly or sign out; a fresh one sees the form.
// 已认证浏览器可直接进入或登出；未认证浏览器看到表单。
session().then(data => {
  if (data && data.user) {
    document.getElementById('who').textContent = data.user.email || data.user.name || '';
    panel.hidden = false;
  } else {
    form.hidden = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const data = new FormData(form);
  const res = await fetch(ORIGIN + '/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
  });
  // One message for every failure: the page never says which field was wrong.
  // 所有失败共用一句话：页面不透露具体错在哪个字段。
  if (!res.ok) { error.textContent = 'Sign in failed / 登录失败'; return; }
  location.href = '/';
});

document.getElementById('enter').addEventListener('click', () => { location.href = '/'; });
document.getElementById('signout').addEventListener('click', async () => {
  await fetch(ORIGIN + '/auth/sign-out', {
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
