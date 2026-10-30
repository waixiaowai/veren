# @veren/workbuddy-protocol

把 WorkBuddy（国内版 copilot.tencent.com）与 WorkBuddy AI（国际版 workbuddy.ai）的
上游线协议做成**零宿主依赖的纯库**：区域表、OAuth 设备码登录、轮换令牌刷新、设备
指纹派生、多账号池、显示层脱敏、上游客户端（chat/目录/计费/探测）与请求体方言。

**何时用**：任何需要直连 WorkBuddy / CodeBuddy 上游的插件或工具；DSH 壳层插件
`@veren/workbuddy-auth` 是它的第一个消费者。协议事实的唯一契约面是
[docs/workbuddy-protocol.cn.md](../../docs/workbuddy-protocol.cn.md)（英文版
[docs/workbuddy-protocol.md](../../docs/workbuddy-protocol.md)）——改线路行为前先改文档。

**怎么用（面而不是教程）**：从 `@veren/workbuddy-protocol` 导入即可；每个模块头部
注释写明职责与风控约束。测试（`pnpm test`）离线回放 `tests/fixtures/` 里的实测形状，
是第二份可执行文档。

```bash
pnpm --dir packages/workbuddy-protocol test    # vitest，不触网
pnpm --dir packages/workbuddy-protocol build   # tsc → dist/
```
