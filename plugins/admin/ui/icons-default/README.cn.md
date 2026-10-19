# @veren/admin-icons-default

## 替换了什么

后台 SPA 的图标层。菜单由宿主带着图标名下发给 SPA（`nav[].icon`），视图向运行时索取该
名字——它们从不导入图标模块，也不自己画 SVG。因此换一个包就能改变全部字形，而无需改动
导航策略或页面。

## 定义了什么

一个图标集（`default`），包含以下名字：

| 名字 | 用在哪 |
|---|---|
| `dashboard` | 仪表盘导航项与页面 |
| `users` | 用户导航项与页面 |
| `shield` | 角色导航项、品牌标记 |
| `audit` | 审计导航项与页面 |
| `capabilities` | 能力导航项与页面 |
| `logout` | 退出登录按钮 |
| `sun`、`moon` | 主题开关（亮 / 暗） |
| `globe` | 语言开关 |
| `plus` | 新建操作 |
| `trash` | 删除操作 |
| `edit` | 编辑操作 |
| `menu` | 移动端侧栏开关 |
| `close` | 关闭对话框 |
| `check` | 确认提示 |

每个值都是自包含的 24×24 `<svg>` 字符串，`fill="none" stroke="currentColor"`、线宽 1.75、
圆角连接、`aria-hidden="true"`。因为颜色来自 `currentColor`，一个图标即可服务亮暗两套方案
与所有强调色。

## 如何替换

图标集像语言一样累加；SPA 合并它们，后加载的包优先，因此品牌包可以只覆盖 `shield` 而继承
其余图标。若要整体替换，禁用本行并启用另一个包：

```yaml
- id: admin-icons-default
  disabled: true
- id: my-brand-icons
  name: '@acme/admin-icons-brand'
```

替代者必须是无依赖的浏览器 ESM 包，其 `client.js` 导出 `activate(runtime)` 并调用
`runtime.registerIcons({ id, label, icons })`。

## 安全提示

这些字符串是 SPA 唯一用 `innerHTML` 写入的标记。图标包本身就是同源可执行代码，因此它获得
与 SPA 本身相同的信任；绝不能用用户或 API 数据拼装图标标记。

## 它不做什么

- 不用远程 SVG、图标字体或 sprite：每个字形都内联。
- 不含颜色与尺寸参数：尺寸来自 CSS（默认 `1em`）。
- 不含语义标签：可访问名称必须由外层控件提供。
