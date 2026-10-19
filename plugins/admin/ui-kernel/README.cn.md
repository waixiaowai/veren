# `@veren/admin-ui-kernel`

适用于后台部署需要提供可替换浏览器 UI 包的场景：它按包清单注册 UI 包、协商 UI 契约
范围、发布登录前与登录后的清单，并在解析包资源时拒绝越出包目录的路径；不提供浏览器 UI
的部署不要使用本包。

## 提供什么

`ctx.adminUi`：

| 方法 | 结果 |
|---|---|
| `register({ manifest, root })` | 移除该包的 disposer；抛出 `CONTRACT_INCOMPATIBLE` 或 `PROVIDER_CONFLICT` |
| `manifest(audience)` | `{ uiContract, packs }`，按种类与 `order` 排序 |
| `asset(packId, relative)` | `{ path, contentType }` 或 `undefined` |

## 清单

登录前只暴露 `shell`、`theme`、`locale`、`icons`；登录后额外暴露 `page` 包。
`@veren/admin-web` 在 `/api/public/v1/ui-manifest` 提供公开清单，在
`/api/admin/v1/ui-manifest` 提供完整清单。

## 资源规则

- 只提供 `.js`、`.mjs`、`.css`、`.json`、`.svg`、`.png`、`.webp`。
- 解析后的路径必须留在包自身目录内；穿越与绝对逃逸都返回 `undefined`。
- 请求路径永远无法选中未注册的包。

## 注册模型

P0 的包通过各自插件行里的 `ctx.adminUi.register()` 自行注册；内核**不**扫描
`package.json` 的 `dsh.admin.ui` 声明。因此一个包同时提供 Host 入口（`index.js`）与它
指向的浏览器 `client.js`。

## 已知限制

- 重复的包 id 抛出 `PROVIDER_CONFLICT`；注册表 JSDoc 仍写作 `CONFLICT`，待更正。
- 不校验完整性哈希或签名；承诺是同源加清单控制，而非供应链证明。
- 资源按请求逐次读盘，没有缓存层。

## 测试

```bash
pnpm exec vitest run --root plugins/admin/ui-kernel
```
