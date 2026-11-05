# @veren/mail-ui

通知技术栈的 Web 面板：一个侧栏入口，打开含两个页签的一页。

挂载在 `@veren/mail` 旁边，读取其 `mail` 远端命名空间——不拥有任何域逻辑与存储。

## 页面

- **收件箱**——站内收件箱，最新在前：每条消息带标题、正文与可见状态，一键标记已读／未读／
  归档／取消归档。
- **执行记录**——每条执行链一行：工作流、结果，以及每步的状态与被跳过的原因。

页面打开期间目录每 5 秒重读一次，关闭即停。样式表只消费外壳的 `--dsw-*` 令牌，因此面板
跟随每一套主题；两种基线语言随包交付，缺一条翻译是编译错误而非运行时的缺失字符串。

## 安装

作为 `@veren/mail-bundle` 的一部分挂载，排在核心之后（它注入挂载好的 `remote.mail` 命名空间）。
无配置。

## 开发

```bash
pnpm --dir plugins/mail/ui typecheck   # 对真实 Harness 源码检查
pnpm --dir plugins/mail/ui test
pnpm --dir plugins/mail/ui build       # esbuild -> dist/index.js + lib/client.js
```
