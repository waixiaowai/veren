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
ctx.tools
```

- 特别注意：优先使用完整的类型面，不要创建别名，别名层只会增加漂移风险