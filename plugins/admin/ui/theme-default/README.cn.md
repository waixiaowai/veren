# @veren/admin-theme-default

## 替换了什么

后台 SPA 的主题层：所有页面与组件消费的 CSS 自定义属性。它是四个可替换 UI 包之一
（主题、语言、图标、外壳）。页面从不写死颜色，只读取 `var(--admin-*)`，因此换一个包
即可改变外观，无需改动任何视图。

## 定义了哪些 token

亮暗两套方案都定义同样的十一个 token：

| Token | 含义 |
|---|---|
| `--admin-bg` | 外壳背后的页面背景 |
| `--admin-surface` | 卡片、顶栏、对话框 |
| `--admin-surface-2` | 表头、悬停行、输入框 |
| `--admin-border` | 细线与控件描边 |
| `--admin-text` | 主文本 |
| `--admin-muted` | 次要文本与元信息 |
| `--admin-accent` | 主操作背景 |
| `--admin-accent-text` | 强调色上的文本 |
| `--admin-danger` | 危险操作与错误 |
| `--admin-radius` | 所有表面共用的圆角 |
| `--admin-shadow` | 对话框与浮层的投影 |

对比度：两套方案中，正文与弱化文字相对 `--admin-bg`、`--admin-surface` 均不低于
4.5:1；强调色与其上的文本同样不低于 4.5:1。

## 如何替换

SPA 使用第一个注册的主题。禁用默认行并启用另一个注册了自己主题 id 的包：

```yaml
- id: admin-theme-default
  disabled: true
- id: my-brand-theme
  name: '@acme/admin-theme-brand'
```

替代者必须是无依赖的浏览器 ESM 包，其 `client.js` 导出 `activate(runtime)` 并调用
`runtime.registerTheme(...)`，提供同样十一个 token。加载失败的包会被跳过并在控制台告警，
SPA 继续用样式表默认值渲染。

## 它不做什么

- 不引入外部字体、图片或远程 URL；token 只是普通值。
- 不做布局决策：间距与网格在 SPA 样式表里。
- 不碰 `localStorage` 或偏好：亮/暗/跟随系统由 SPA 负责。
