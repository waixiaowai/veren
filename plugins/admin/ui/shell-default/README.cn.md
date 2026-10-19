# @veren/admin-shell-default

## 替换了什么

后台 SPA 的外框身份。外壳包回答“这个部署用的是哪种壳”；SPA 从样式表渲染侧栏、顶栏与可
滚动内容区，并从 `bootstrap.nav`——而不是本包——读取菜单内容。

这样布局集中在一处（SPA），身份集中在另一处（包），因此重命名或换肤外壳的部署不必分叉
SPA。

## 定义了什么

恰好一个外壳贡献：

| 字段 | 值 |
|---|---|
| `id` | `default` |
| `label.en` | `Default shell` |
| `label.zh` | `默认壳` |

不含 token、消息或图标：那些属于主题、语言与图标包。

## 如何替换

SPA 使用第一个注册的外壳。禁用本行并启用另一个包：

```yaml
- id: admin-shell-default
  disabled: true
- id: my-shell
  name: '@acme/admin-shell-brand'
```

替代者必须是无依赖的浏览器 ESM 包，其 `client.js` 导出 `activate(runtime)` 并调用
`runtime.registerShell({ id, label })`。由于加载失败的包会被跳过，即使一个外壳包都没有，
SPA 仍会用内置布局继续渲染。

## 它不做什么

- 不含布局、CSS 或标记：全部由 SPA 负责。
- 不访问数据：外壳从不取数，只接收 `bootstrap`。
- 不做授权：菜单可见性由宿主导航能力决定，且每条路由仍在服务端强制校验。
