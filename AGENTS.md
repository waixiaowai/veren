- 所有的代码及注释都是给人看的，保证良好的可读性和可维护性，注释要求中英文双语
- **真机/宿主级验证只有一条路**：本文件「稳定测试节点」一节的配方。人工禁止自建 `~/.dsh_test/*` 之类临时节点（该目录仅限 e2e 自动化脚本创建与清理，见「一次性测试节点」）；禁止自创启动命令。实际命令与本节不符时，先回来改这一节，不许就地绕过
- apps|cargos|packages/**/package.json|Cargo.toml必须提供description英文说明，提供的判断是否使用这个package的依据，只什么情况下使用，不要怎么用
- apps|cargos|packages/** 怎么用: 每个包提供中文/英文双语的开发使用文档README.md和README.cn.md
- docs: 对外的面向开发者|用户等各种用户的手册|教程文档的存放位置，面向不同的人群，要根据人群的特征，编写易于阅读和理解的规范的文档，每个文档都有中英两个文件，如README.md英文+README.cn.md中文
- Typescript: 单元测试使用 vitest
- 源码编写规范，每个包|文件|类|函数等都需要保持单一职责，单文件300行以内，单函数/方法30行以内,每个包源文件(.rs|ts)不超过5个文件
- 编写代码之前，先使用 apps\cli 开发的cli工具，查看已有功能，避免重复造轮子，也可以将代码放在适当的包内，然后评估确定(添加依赖|自己造轮子)方案
- 在编写子包时，使用pnpm cli list name 查看这个包的依赖的第三方工具包
- 编写插件必须使用"@deepseek-ai/schemastery"定义config
- 插件的 DSH 依赖只写 peerDependencies+devDependencies，版本契约只写 engines.dsh；`dependencies` 里出现 cordis/dsh-* 会装出第二份实例（门禁 `pnpm check:plugins`，规则见 docs/dsh-plugin-versions.cn.md）
- vendor目录下的内容禁止修改，存放一些第三方的源码
- 比较重要的Service自定义生命周期：Service.init/Service.check/Service.invoke，调试用Service.tracker
- 插件类型支持Plugin.Function<T> 禁止 default export |Plugin.Constructor<T> export default class X extends Service |Plugin.Object<T>，注意inject依赖的是能力(Service)
- 所有注册动作要确保卸载时逆序清理，不会泄漏
- 事件系统 emit(通知)|parallel(通知)|serial(拦截)|bail(拦截)|waterfall(加工)
- 创建带附加元数据的子 context: ctx.extend(meta); 为服务名开辟独立作用域: ctx.isolate(name, label?); 为子树注入服务配置覆盖: ctx.intercept(name, config)
- src/types.ts 只放类型，测试放包级 tests/
- vitest.config.ts *.spec.ts 单测 | vitest.e2e.config.ts *.e2e.ts 真实 API、花 token，无凭据自跳过，retry: 2
- 规范："单独跑才过的 spec 是缺陷"（必须并发安全）；registry 贡献必须带 dispose/HMR 安全测试；插件要有走真实 Loader 的 composition 测试
- 可复用的测试基建（Reusable test-support packages，优先复用，不要重复造轮子）位于 deepseek\deepseek-harness\packages\test-support\：
  - `agent-loop-testkit` – agent 循环测试工具 / agent loop test toolkit
  - `client-runtime` – 客户端运行时测试支持 / client runtime test support
  - `llm-mock-server` – LLM mock 服务器 / mock LLM server
  - `llm-replay` – LLM 录制回放 / LLM record & replay
  - `loader-smoke` – Loader 冒烟测试 / loader smoke tests
  - `remote-mock` – 远端 mock / remote endpoint mock
  - `session-snapshot` – 会话快照 / session snapshot utilities
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

- 稳定测试节点（长期存在、可反复用、源码直接起；手动/交互验证一律用它）
  - 目录: DSH_HOME=deepseek\.dsh（即工作区下 deepseek\.dsh）；密钥已就位：`.credentials.yaml` 是从 ~/.dsh **只读复制**来的 dev 自己副本，credentials-local 只读它；对 ~/.dsh 只允许"复制出去"，禁止回写
  - 现有内容: `profiles\imtest`（bundles: `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）、`storages\`
  - 版本依据: 源码检出 `deepseek\deepseek-harness` 为 `master@687f282e86`、`@deepseek-ai/dsh-root 0.2.1-rc.2`，与桌面运行时（54224）**同版本、差为 0**——用源码验证即可代表真机
  - 构建（一次性）: `pnpm --dir deepseek\deepseek-harness run build`；`.dsh-build` 目录为空 = client 产物未构建，直接起会失败
  - 启动: `$env:DSH_HOME='C:\Users\imeep\Documents\cursour\deepseek\.dsh'; pnpm --dir deepseek\deepseek-harness dsh web --port 3080 --no-open`（`dsh web` 默认就是 web profile，不要再传 `--profile`，会报 "select a profile only once"；启动报核心行被兼容检查禁用时，按日志对每个包执行 `dsh plugin --profile web allow-version <pkg>@<ver> --dsh-version <runtime> --accept-risk`）
  - 开发循环（改源码自动重编）: `pnpm --dir deepseek\deepseek-harness run dev:web -- --port 3080 --no-open`（与 `pnpm run build` 互斥，不可并行）
  - 装插件: `pnpm --dir deepseek\deepseek-harness dsh plugin --profile web add <本仓库插件路径>`（源码版 CLI 支持本地路径安装；我们的包 engines.dsh `>=0.2.1-rc.2 <0.3.0` 恰好匹配，装组合包如 `plugins\app-host-bundle`，成员包不单独装）；`workspace:^` 依赖在路径安装时解析失败就退到 tarball + `scripts/repack.mjs` 重写依赖
  - 装前先写 profile `.npmrc`（四行见下方「新建/安装一次性测试节点」第 1 步，authToken 指到真实来源文件）：专用 `store-dir` + `package-import-method=copy`，断开与桌面的 inode 共享
  - 隔离结论: 该 home 与 `~/.dsh`、54224 桌面版**无共享状态**（profile/storages/凭据全在 dev home 内）；唯一例外：`~/.agents`（设计上的共享 agents 根，只读）与 pnpm store（靠上面的 `.npmrc` 隔离）
  - 三个坑: ① client 产物未构建；② `workspace:^` 路径安装解析失败；③ pnpm 11 build-script 审批（安装报 `pendingBuilds` → Web 插件页 Allow scripts and retry）叠加核心行兼容检查（`allow-version --accept-risk`）
- dsh_test_1、dsh_test_2 已清理删除：仓库内如再引用即过期，需订正

- 一次性测试节点（**仅限 e2e 自动化脚本创建、使用并清理；人工禁止手动创建**，手动验证一律走上面的稳定节点）
目录：DSH_HOME=~/.dsh_test/编号；密钥从 ~/.dsh/.credentials.yaml **只读复制**出去（复制允许，回写 ~/.dsh 禁止）
创建/清理责任人：发起 e2e 的会话负责按下方流程创建并在测试结束后删除整个节点目录

## 新建/安装一次性测试节点（**仅 e2e 自动化脚本使用，人工禁止执行**；必须按此顺序，顺序不能反）

1. 先写 profile `.npmrc`，四行缺一不可（authToken 只读复制，不写明文进文档）：
```ini
store-dir=<节点目录>\.pnpm-store
package-import-method=copy
@veren:registry=https://npm.veren.top/
//npm.veren.top/:_authToken=<从 C:\Users\imeep\.dsh\profiles\desktop\.npmrc 的同名键只读复制；该键不存在时向用户索取并说明用途与权限范围>
```
2. 再初始化 profile（`dsh plugin --profile web version-exemptions` 即可完成初始化，不跑 pnpm）
3. 再安装（`dsh plugin --profile web add <tarball>`）
4. 插件要作为 profile 层加载，`package.json` 必须声明：
```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```
patch 文件是 loader 行数组（见 plugins\auth\cordis.patch.yml、plugins\person-agent-bundle\cordis.patch.yml）；缺此声明 = 只装成普通依赖，宿主不加载。成员插件禁止自带 bundle：只作为普通依赖随组合包（如 person-agent-bundle）安装，由组合包统一插入配置行，避免 reconciliation 激活重复层
5. 装完两项校验：
```powershell
# a. bundle 选择列表必须含本插件
Get-Content <节点目录>\profiles\web\package.json | Select-String 'bundles' -Context 0,5
# b. 与 ~/.dsh 零共享 inode（不得出现 \.dsh\profiles\desktop 路径）
fsutil hardlink list "<节点目录>\profiles\web\node_modules\@deepseek-ai\dsh-client-modules\lib\client.js"
```

## DSH profile 操作规范（防桌面白屏）

原理（一句话）：桌面按 `(mtime, ctime, size)` 算 client bundle 的 rev 寻址加载；pnpm 的硬链接让 ctime 成为 **inode 级共享**——任何 profile 上的安装/重链/删除/回滚都会改掉共享文件的 ctime → 桌面 rev 失效 → 白屏。因此以下全是强制规定：

1. **agent 会话跑在桌面端进程里，崩溃 = 自杀**。对任何 profile（含测试节点）执行 pnpm 前，先 `fsutil hardlink list <目标文件>` 确认与 `~/.dsh` 无共享 inode
2. **禁止修改 `~/.dsh` 下任何文件**；所有插件禁止安装到 `~/.dsh`；执行 `dsh plugin` 前必须核对 `DSH_HOME` 指向测试节点目录并打印确认
3. 每个测试节点/一次性节点必须使用**自己的专用 store**（`store-dir`）+ `package-import-method=copy`，禁止使用全局 `AppData\Local\pnpm\store`；禁止把节点重链进与桌面相同的 store
4. 桌面端在跑 → 禁止对 `DSH_HOME=~/.dsh` 做任何写操作（`dsh plugin add|remove`、GUI 插件管理器、`pnpm install|add|rebuild`、改 `dsh.profile.bundles`）
5. 必须改 `~/.dsh` → 先完全退出桌面端（含托盘），改完冷启动；启动后 3~5 秒内不写 profile
6. 任何 profile 写入之后 → 立刻 Ctrl+R 重载窗口
7. 白屏 ≠ 损坏 → Ctrl+R / 重开窗口即恢复；禁止重装、禁止 pnpm reinstall
8. `DSH_HOME` 每命令显式指定，不设全局；命令前打印实际 HOME 核对
9. 不用 npx 形态运行 dsh；不在桌面运行期间做任何 pnpm relink（v10/v11 store 混用会 `ERR_PNPM_UNEXPECTED_STORE` 并触发强制重链）
10. 备份/同步只允许"复制出去"，禁止回灌覆盖 profile 目录
11. 开发自己的客户端插件：改完主动 Ctrl+R；看到白屏先重载，不要怀疑代码写坏了

## 白屏现场处置（只读）

```powershell
# 1) 磁盘当前 rev（与崩溃日志里的 rev 比对；不一致 = 过期代）
node -e "const crypto=require('crypto'),fs=require('fs');const p=process.env.USERPROFILE+'/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js';const s=fs.statSync(p);console.log(crypto.createHash('sha1').update('plugin-artifact\0'+JSON.stringify([s.mtimeMs,s.ctimeMs,s.size])).digest('hex').slice(0,12),new Date(s.ctimeMs).toISOString())"
# 2) 崩溃日志（含失败 rev）
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs" -Filter "crash-*-web-boot.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 3
```
处置：完全退出桌面 → 重新打开（过期代可能叠多层，Ctrl+R 不行就冷启动）；禁止重装

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
