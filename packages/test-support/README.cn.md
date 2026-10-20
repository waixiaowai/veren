# @veren/test-support

应用层插件 spec 共用的测试基建。当一条 spec 需要搭带应用服务的 Cordis 测试宿主
（`ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter`）、接注册表→页面注册表的
镜像缝、伪造每会话的 agent 作用域，或开一个用完即弃的存储域时，用这个包，
而不是把这套接线再抄进下一条 spec。它**不会**启动真实 DSH profile——那请用
`loader-smoke` 测试基建。

不需要宿主的领域级单元测试、以及必须端到端跑真实会话/工具运行时的 spec，
不要用它。

## 最小例子

```ts
import { expectPagesRegisteredOnce, mountAppHost } from '@veren/test-support'

const host = await mountAppHost()          // apps + pageRegistry + 镜像面，无 taskCenter
const fiber = host.ctx.plugin(MyAppPlugin) // 你的应用插件；host.apps 已就位
await fiber

if (host.apps === undefined || host.pageRegistry === undefined) throw new Error('no registries')
expectPagesRegisteredOnce(host.apps, host.pageRegistry, MY_APP_ID)
await host.dispose()                       // 逆序拆除，临时目录删净
```

## 提供什么

- `mountAppHost(options?)`——把「构造 + provide + 镜像面」收成一条路径：真实激活
  `AppRegistryPlugin` / `PageRegistryPlugin`、一处接好镜像缝、最小 `tools` /
  `agentPresets` 替身。选项（`registries` / `storage` / `taskCenter` /
  `agentPresets`）可以把服务**关掉**来测降级路径。`dispose()` 逆序拆净。
- `TempDirs` / `mountStorage(ctx, dirs)`——每个测试一份临时目录，建在系统临时
  目录下（绝不落仓库），创建与清理严格成对。
- `installFakeSessions(ctx)` / `ToolTable`——假会话/agent 端口：每个会话的
  agent 作用域是真实的 cordis 子上下文（`isolate('tools')`），足以断言「页面
  工具挂进了哪条会话、会话销毁后工具不可见」。
- `expectPagesRegisteredOnce(apps, pageRegistry, appId)`——单入口注册一致性：
  应用目录里的页面与页面注册表能解析到的页面双向一一对应。
- `expectAppRemoved(apps, pageRegistry, appId, urls)`——卸载摘净检查。

英文文档见 `README.md`。
