- 所有的代码及注释都是给人看的，保证良好的可读性和可维护性，注释要求中英文双语
- apps|cargos|packages/**/package.json|Cargo.toml必须提供description英文说明，提供的判断是否使用这个package的依据，只什么情况下使用，不要怎么用
- apps|cargos|packages/** 怎么用: 每个包提供中文/英文双语的开发使用文档README.md和README.cn.md
- docs: 对外的面向开发者|用户等各种用户的手册|教程文档的存放位置，面向不同的人群，要根据人群的特征，编写易于阅读和理解的规范的文档，每个文档都有中英两个文件，如README.md英文+README.cn.md中文
- Typescript: 单元测试使用 vitest
- 源码编写规范，每个包|文件|类|函数等都需要保持单一职责，单文件300行以内，单函数/方法30行以内,每个包源文件(.rs|ts)不超过5个文件
- 编写代码之前，先使用 apps\cli 开发的cli工具，查看已有功能，避免重复造轮子，也可以将代码放在适当的包内，然后评估确定(添加依赖|自己造轮子)方案
- 在编写子包时，使用pnpm cli list name 查看这个包的依赖的第三方工具包
- 编写插件必须使用"@deepseek-ai/schemastery"定义config
- vendor目录下的内容禁止修改，存放一些第三方的源码
- 比较重要的Service自定义生命周期：Service.init/Service.check/Service.invoke，调试用Service.tracker
- 插件类型支持Plugin.Function<T> 禁止 default export |Plugin.Constructor<T> export default class X extends Service |Plugin.Object<T>，注意inject依赖的是能力(Service)
- 所有注册动作要确保卸载时逆序清理，不会泄漏
- 事件系统 emit(通知)|parallel(通知)|serial(拦截)|bail(拦截)|waterfall(加工)
- 创建带附加元数据的子 context: ctx.extend(meta); 为服务名开辟独立作用域: ctx.isolate(name, label?); 为子树注入服务配置覆盖: ctx.intercept(name, config)
- src/types.ts 只放类型，测试放包级 tests/
- vitest.config.ts *.spec.ts 单测 | vitest.e2e.config.ts *.e2e.ts 真实 API、花 token，无凭据自跳过，retry: 2
- 规范："单独跑才过的 spec 是缺陷”（必须并发安全）；registry 贡献必须带 dispose/HMR 安全测试；插件要有走真实 Loader 的 composition 测试
- waterfall 监听器必须调 next()，否则短路整条链（事件契约的强制面）
- 事件类型走 declaration merging，JSDoc 必须标注 @mode（emit/bail/...）
- 跨边界 id 用 brand（Branded<B> = string & {...}，零运行时开销）；闭集 union 用 assertNever 收尾
- 错误要结构化：带稳定 code（如 SETTINGS_CONFLICT）+ 机器可读字段；misconfiguration fails loud
- 本地导入带 .ts 后缀、全 ESM NodeNext；spawn 前环境净洗（剥 KEY/PASSWORD/SECRET/TOKEN 和 DSH_*，大小写不敏感——Windows 陷阱）

- 常用命令
```bash
pnpm cli help
pnpm cli list
pnpm cli list @veren/yaml-parser
pnpm cli doc @veren/yaml-parser
```

- 推荐Service写法
```ts
export const DemoToken = defineToken<DemoService>(`demoToken`)
export class DemoService extends Service {
    constructor(ctx: Context){
        super(ctx, DemoToken)
    }
}
```

- 推荐插件写法
```ts
import type * as ts from 'typescript';
import { getOrThrow } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery'
import { name as ProgramToken } from '@veren/compiler-program';
export const name = 'verenTypeChecker'
export interface Config { }
export const Config: z<Config> = z.object({})
export const inject = [ProgramToken]
export const provide = []
export const apply = (ctx: Context) => {
    const program = getOrThrow(ctx, ProgramToken)
    // todo
}
```

- 推荐client 插件写法，使用react + tsx + css module + 组件化 + 多主题 + 多语言 + 复用基础设施 如: Toast/Dialog等，放在插件目录下的 src/client/目录中
1. 复用dsh组件库
2. 复用dsh客户端Service
3. 复用dsh 钩子如： useWorkspaces等
4. 复用dsh 多主题
5. 复用dsh 多语言 ctx.effect(() => ctx.locale.register(NS, { zh, en }), '...')
6. 铁律一：往别人的 slot 注册，必须用 ctx.slots.inject(name, () => ctx.slots.register(...))
7. 铁律二：children = 声明 + 授权。你渲染哪些子 slot，注册项的 children 就必须恰好声明哪些（kind: 'single'|'list'|'keyed' + scope）
8. 组件 props 全部是派生共享，禁止手写：PropsRuntime（owner 数据）、PropsRenderSlots（children）、PropsStore、PropsHooks（inject 的 hooks 面）、PropsLocale。这些类型别名都从 @deepseek-ai/dsh-client-ui-slots 取
9. inject 工厂只返回普通数据和回调（apply 闭包里的东西）——禁止手造钩子、禁止返回 ReactNode、禁止返回整个 Service 对象。动态事实必须包成 HostObservable（{ getSnapshot, subscribe }，且源对象与快照引用保持稳定）放进 hooks。
10. ctx 只属于 apply 世界：组件永不接触 ctx、不 import Service 类、不读 React context。组件要新东西 = 从 owner site / store / inject face 穿一根 prop 下来。
11. 业务数据活在对象层（Session/Workspace Controller），store 只放查看/交互状态（选中、草稿、面板宽度）。
12. 派生数据是框架钩子数据上的纯函数（derive/useMemo），不自己订阅。
```ts
// 类型-only import：只为拉取各 Service 的 declaration merge（ctx.slots、ctx.locale 等）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 服务级注入：cordis fiber 等待这些**服务**，这才是真正的激活顺序
export const inject = ['slots', 'sessions', 'workspaces', 'locale', ...]
export function apply(ctx: Context): void { ... }
```

- 稳定测试节点，所有已稳定运行的插件安装到这里
目录: DSH_HOME=~/.dsh_test_1 密钥从~/.dsh/.credentials.yaml拷贝 地址：http://127.0.0.1:3080/
邮箱：admin@dsh.local 密码: dsh-test-admin

- 一次性测试节点，测试结束后清理，用于e2e自动化测试
目录：DSH_HOME=~/.dsh_test/编号，密钥从~/.dsh/.credentials.yaml拷贝

## 注意
- 跨包共享用 import type，行为走注入的 Cordis 服务，UI 走 slots
- 跨平台最佳实践示例
```ts
0. plugins\device-id 其他插件依赖这个 不依赖具体平台 
1. plugins\device-id-win win平台按装
2. plugins\device-id-mac mac平台安装
3. plugins\device-id-linux Linux平台安装使用
```

- 系统服务正确写法，类型安全
```ts
import type { } from '@deepseek-ai/dsh-tools';
// ctx.tools
```

- 特别注意：优先使用完整的类型面，不要创建别名，别名层只会增加漂移风险
- 特别注意：禁止任何修改~/.dsh 目录下的任何文件，所有的插件不能安装到~/.dsh目录切记，特别是执行 dsh plugin 命令时，一定要确保 DSH_HOME 对不对，一旦搞错，会彻底崩溃，因为你在dsh desktop下工作，崩溃等于自杀

## 桌面端白屏 = client bundle 的 rev 被 relink 打废（2026-10-15 复盘，必读）

- 结论：白屏**不是插件文件损坏**，而是客户端 bundle 的 rev 过期导致 bootstrap 脚本 404
  - 宿主按 `(插件id, rev)` 精确寻址：`/plugins/??<pkg>/client.js&rev=<rev>`
  - rev **只由文件元数据**决定：`rev = sha1("plugin-artifact"\0, [mtimeMs, ctimeMs, size])` 取前 12 位十六进制 —— 内容哈希不参与
  - 单行 row URL 只在"当前这一代"注册（上一代只保留 batch URL）→ 旧 rev 立刻 404，没有回退
  - `@deepseek-ai/dsh-client-modules` 是**唯一 bootstrap 行**（`PARSER_PRELOAD_IDS`），它 404 → `__DSH_BOOT_READY__` 被 reject → `window.__ModuleLoader__` 永不安装 → 所有客户端插件都不装载 → 白屏
- 关键陷阱：**硬链接重建只改 ctime，不改内容**。pnpm relink / 包投影 / 复制覆盖恢复，都会让**内容 1 字节没变、rev 整代变化**

### 铁律（桌面端运行期间，`~/.dsh` 只读）

1. 桌面端在跑 → 禁止对 `DSH_HOME=~/.dsh` 做任何写操作：`dsh plugin add|remove`、GUI 插件管理器安装/修复/更新、`pnpm install|add|install --force|rebuild`、启用或禁用 bundle（改 `dsh.profile.bundles`）
2. 必须改 → **先完全退出桌面端**（含托盘/后台），改完再启动（冷启动一次定型）；启动后 3~5 秒内不要再写 profile（这是 boot 窗口期）
3. 任何一次写入之后 → **立刻 Ctrl+R 重载窗口**，不要直接继续用
4. 白屏 ≠ 损坏 → `Ctrl+R` / 重开窗口即恢复；**禁止重装、禁止 pnpm reinstall**
5. `DSH_HOME` 每命令显式指定，**不设全局**（全局会把从同一 shell 启动的桌面端一起带偏）；命令前打印实际 HOME 做核对
6. 不用 `npx` 形态运行 dsh（会在 `~/.dsh/profiles/node_modules` 建指向 npx 哈希目录的 junction，解析锚点漂移）；固定 pnpm 版本与 store（v10/v11 混用会 `ERR_PNPM_UNEXPECTED_STORE` 并触发强制重链）
7. 备份/同步只允许"复制出去"，**禁止回灌覆盖** profile 目录（robocopy、解压、网盘同步都会让全量 ctime 变化）
8. 开发自己的客户端插件：改完主动 `Ctrl+R`，别指望 live 自动重载恰好落在安全时机；看到白屏先重载，不要怀疑代码写坏了

### 自查（只读，不改任何东西）

```powershell
# 1) bootstrap 行的元数据：ctime 晚于窗口启动时间 = 已被 relink（看 mtime 是看不出来的）
#    bootstrap row metadata: a ctime newer than the window start means it was relinked
node -e "const s=require('fs').statSync(process.env.USERPROFILE+'/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js');console.log('mtime',new Date(s.mtimeMs).toISOString(),'ctime',new Date(s.ctimeMs).toISOString(),'size',s.size)"

# 2) 谁重链的：目标落在 pnpm store v10/v11 就是哪套 pnpm 干的
#    who relinked it: the store path tells which pnpm did it
fsutil hardlink list "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@deepseek-ai\dsh-client-modules\lib\client.js"

# 3) 桌面端崩溃日志（白屏现场，含失败 URL 与 rev）
#    crash logs of the desktop window (failed URL + rev)
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs" -Filter "crash-*-web-boot.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name,LastWriteTime
```

- 崩因判读：日志里 `desktop web: failed to load plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=<X>`，且 X 与磁盘上任何副本算出的 rev 都不相等 → 该行用的是**过期一代**的 rev
- 已知坏账（别假设 profile 是干净的）：`~/.dsh/profiles/node_modules` 的 **617 个 junction 全部悬空**，指向已删除的旧安装 `%LOCALAPPDATA%\Programs\DSH Desktop\resources\app.asar.unpacked` 与失效的 npx 缓存 → 解析锚点可能漂移
- 事故记录：2026-10-15 15:16:51 与 16:12:02 两次白屏，失败行 rev 分别为 `fd31d33c4cd8` / `f2f47ba3a70a`，磁盘上均无对应副本；同一次 boot 的其它行（locale / cordis-client-runner / sidebar-right）rev 与磁盘完全一致 → 只有 bootstrap 行错代
- 别白费力气：`package.json` 里的 `"patchReload": "live"` 在桌面端 0.2.0-rc.2 的 `app.asar` 内**没有任何读取代码**（正向对照：`profile.bundles`、`OPTIONAL_BUNDLES` 都能搜到，`patchReload` 搜不到）→ 不要拿它当开关