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