# @veren/admin-locale-zh-en

## 替换了什么

后台 SPA 的消息层。所有可见字符串——菜单标签、表头、按钮、空态与错误态、提示——都通过
语言词典解析，因此部署方可以整体改写文案而不碰 SPA。菜单标签由宿主以键的形式下发
（`bootstrap.nav[].labelKey`），所以同一份词典同时服务导航与页面。

## 定义了什么

两个语言 `zh` 与 `en`，键集完全一致：

| 命名空间 | 覆盖范围 |
|---|---|
| `app.*` | 标题、加载/空/错误态、重试/取消/保存/删除/关闭、404 与 403 文案 |
| `nav.*` | 来自导航能力的侧栏标签 |
| `auth.*` | 登录与首次初始化文案，含 `auth.invalid` |
| `dashboard.*`、`users.*`、`roles.*`、`audit.*`、`capabilities.*` | 页面标题、表头、操作 |
| `common.*` | 是 / 否 |
| `health.*` | 健康角标：正常、降级、不可用 |
| `theme.toggle`、`locale.toggle` | 顶栏开关标签 |
| `toast.*` | 简短成功提示 |

## 缺失键怎么办

SPA 回退到键本身，绝不回退到另一种语言。因此只提供 `users.*` 的包会在缺少标签处显示
`nav.roles`——可见、可检索、一处即可修复。

## 如何替换

语言是累加的：运行时会注册每个包发布的每种语言，因此第二个包可以直接增加 `ja` 或 `de`
而不必禁用本包。若要替换 `zh`/`en` 的措辞，禁用默认行并启用你的包；SPA 保留已保存的语言
id，该语言消失时回退到第一个已注册语言。

```yaml
- id: admin-locale-zh-en
  disabled: true
- id: my-copy
  name: '@acme/admin-locale-brand'
```

替代者必须是无依赖的浏览器 ESM 包，其 `client.js` 导出 `activate(runtime)` 并调用
`runtime.registerLocale({ id, label, messages })`。

## 它不做什么

- 不含日期与数字格式表：SPA 用 `Intl` 配合语言 id。
- 不含复数规则与插值：上面的键都是完整句子。
- 不碰 `localStorage`：当前语言由 SPA 负责。
