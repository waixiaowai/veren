# `@veren/admin-ui-contract`

适用于浏览器侧后台插件需要稳定 UI 契约的场景：它声明包清单、按受众的清单、主题/语言/
图标/壳/页面贡献类型，以及包收到的运行时对象，因此包与 SPA 可以各自独立演进；只需要
Host 能力类型时不要使用本包。

## 包

一个包是同源 ESM 入口，导出一个 `activate(runtime)` 函数。它只携带数据，绝不放直接触达
网络或 DOM 的代码。

| 种类 | 贡献 | 登录前可用 |
|---|---|---|
| `shell` | 壳的身份与显示名 | 是 |
| `theme` | 亮色与暗色的 CSS 自定义属性 | 是 |
| `locale` | 消息字典 | 是 |
| `icons` | 名称 → 内联 SVG | 是 |
| `page` | SPA 路由、标题 key、权限、图标 | 否 |

`UiPackManifest` 包含 `id`、`version`、`uiContract`、`kind`、同源 `entry`、双语
`label`、可选 `description` 与 `order`。

## 运行时

`AdminUiRuntime` 暴露 `contract` 以及 `registerTheme`、`registerLocale`、
`registerIcons`、`registerShell`、`registerPage`。包只注册数据；渲染、路由、持久化与
可访问性由 SPA 负责。

## 主题 token

主题必须在两种方案下都定义 `--admin-bg`、`--admin-surface`、`--admin-surface-2`、
`--admin-border`、`--admin-text`、`--admin-muted`、`--admin-accent`、
`--admin-accent-text`、`--admin-danger`、`--admin-radius` 与 `--admin-shadow`。缺失
token 会静默回落到样式表默认值，破坏“换主题只改值”的承诺。

## 契约版本

`UI_CONTRACT_VERSION = '1.0.0'`。包声明范围（`^1.0`），UI 内核在发布前完成协商。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/ui-contract
```
