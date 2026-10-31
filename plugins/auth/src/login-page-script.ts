/**
 * Inline script fragment of the login page: DOM handles, the session probe
 * (fail-open to the form), the submit handler (one message for every
 * failure), and the enter/sign-out navigation. Helpers return raw JavaScript
 * lines ending in a newline; concatenating them reproduces the original
 * script byte for byte.
 * 登录页内联脚本片段：DOM 句柄、会话探测（任何失败都兜底显示表单）、提交
 * 处理器（所有失败共用一句话）与进入/登出导航。辅助函数返回以换行结尾的
 * 原始 JavaScript 行；按序拼接即可逐字节复现原先的脚本。
 * @module src/login-page-script
 */

/**
 * DOM handles, the session probe helper and `showForm`, ending with a blank
 * separator line.
 * DOM 句柄、会话探测辅助函数与 `showForm`，以空行分隔结尾。
 * @returns JavaScript text ending in a newline. 以换行结尾的 JavaScript 文本。
 */
function loginScriptState(): string {
  return `const form = document.getElementById('signin');
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

`
}

/**
 * The startup probe: an authenticated browser sees the signed-in panel,
 * everyone else (and any probe failure) sees the form.
 * 启动探测：已认证浏览器看到已登录面板，其余情况（含探测失败）显示表单。
 * @returns JavaScript text ending in a newline. 以换行结尾的 JavaScript 文本。
 */
function loginScriptProbe(): string {
  return `session().then(data => {
  if (data && data.user) {
    document.getElementById('who').textContent = data.user.email || data.user.name || '';
    panel.hidden = false;
  } else {
    showForm();
  }
}).catch(showForm);

`
}

/**
 * The submit handler: post to Better Auth, re-enable on failure, redirect to
 * the SPA entry on success.
 * 提交处理器：提交到 Better Auth，失败时恢复按钮，成功后跳转 SPA 入口。
 * @returns JavaScript text ending in a newline. 以换行结尾的 JavaScript 文本。
 */
function loginScriptSubmit(): string {
  return `form.addEventListener('submit', async (event) => {
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

`
}

/**
 * The signed-in panel actions: enter the SPA, or sign out and return here.
 * 已登录面板动作：进入 SPA，或登出后返回本页。
 * @returns JavaScript text ending in a newline. 以换行结尾的 JavaScript 文本。
 */
function loginScriptNav(): string {
  return `document.getElementById('enter').addEventListener('click', () => { location.href = '/'; });
document.getElementById('signout').addEventListener('click', async () => {
  await fetch('/auth/sign-out', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: '{}',
  });
  location.href = '/login';
});
`
}

/**
 * Compose the full inline script from the section fragments, in the original
 * declaration order, closing the document's `<body>` (the byte order
 * `</script>` before `</body>` is preserved).
 * 按原始声明顺序把各段脚本拼成完整内联脚本，并闭合文档的 `<body>`（保持
 * `</script>` 在 `</body>` 之前的字节顺序）。
 * @returns the `<script>` element and `</body>` text. `<script>` 元素与 `</body>` 文本。
 */
export function renderLoginScript(): string {
  return `<script>
${loginScriptState()}${loginScriptProbe()}${loginScriptSubmit()}${loginScriptNav()}</script>
</body>
`
}
