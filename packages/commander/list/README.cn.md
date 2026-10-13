# @veren/commander-list

[English](./README.md)

veren CLI 鐨?`list` 鍛戒护 鈥斺€?鏍囧噯 Cordis 鎻掍欢妯″潡锛氭敞鍏ュ懡浠ゆ敞鍐岃〃涓?Discovery
鏈嶅姟锛屾敞鍐?`list` 鍛戒护锛屾妸鍏ㄩ儴宸ヤ綔鍖哄崟鍏?`{ name, description, dir }` 浠?JSON 杈撳嚭骞舵寜 `dir` 鎺掑簭锛汮SON 缂╄繘鏉ヨ嚜 schemastery 瀹氫箟鐨?`Config`
schema锛坄indent`锛夈€?
## 浣曟椂浣跨敤

- 浣犵粍瑁?veren CLI 杩愯鏃讹紙`apps/cli` 宸插寘鍚湰鎻掍欢锛夛紝闇€瑕佸崟鍏冩竻鍗曞懡浠ゃ€?- 浣犺鍦ㄨ嚜宸辩殑 commander 宸ュ叿閲岃幏寰楀悓鏍风殑 JSON 娓呭崟杈撳嚭銆?
鐩存帴娑堣垂 `@veren/commander-discovery` 骞惰嚜宸辨覆鏌撴椂璇疯烦杩囨湰鍖呫€?
## 瀹夎

```json
{
  "dependencies": {
    "@veren/commander-list": "workspace:*"
  }
}
```

## 蹇€熷紑濮?
```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'
import * as CommandsHost from '@veren/commander-core'
import * as Discovery from '@veren/commander-discovery'
import * as Project from '@veren/commander-project'
import * as ListCommand from '@veren/commander-list'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(CommandsHost) // 鍛戒护娉ㄥ唽琛?await ctx.plugin(Project)
await ctx.plugin(Discovery)    // 鍗曞厓娓呭崟鏈嶅姟锛坕nject = [Project]锛?await ctx.plugin(ListCommand)  // 娉ㄥ唽 `list`锛坕nject = [Commands, Discovery]锛?```

閰嶇疆缁?`ctx.plugin(ListCommand, { indent: 4 })` 浼犲叆銆?
## 浠ょ墝瀛愯矾寰勶紙骞冲彴鏃犲叧锛?
`./tokens` 鍙鍑?`INDENT` 浠ょ墝锛坄indent` 閰嶇疆瀛楁鍚嶏級鈥斺€?涓嶅惈 Cordis銆?涓嶅惈 Node 鍐呯疆妯″潡 鈥斺€?閰嶇疆闈㈡澘绛夊钩鍙版棤鍏虫秷璐规柟寮曠敤璇ュ瓧娈垫椂鏃犻渶瀵煎叆鎻掍欢鏈綋锛?
```ts
import { INDENT } from '@veren/commander-list/tokens' // 鍙湁浠ょ墝锛屼笉鎷栧叆 Cordis
```

## 鎺ュ彛

妯″潡鍗虫彃浠?鈥斺€?浠ュ懡鍚嶇┖闂村鍏ヨ杞斤紙`ctx.plugin(...)`锛夛細

| 瀵煎嚭 | 绫诲瀷 | 璇存槑 |
| --- | --- | --- |
| `name` | 瀛楃涓诧紙`'verenCliListCommand'`锛?| 鎻掍欢鏄剧ず鍚嶃€?|
| `inject` | `[Commands, Discovery]` | 渚濊禆鍛戒护娉ㄥ唽琛ㄤ笌 Discovery 鏈嶅姟銆?|
| `Config` | schemastery schema | `{ indent: number }` 鈥斺€?JSON 缂╄繘绌烘牸鏁帮紙缂虹渷 `2`锛岃寖鍥?`0..10`锛夈€?|
| `apply(ctx, config)` | 鎻掍欢鍑芥暟 | 娉ㄥ唽 `list` 鍛戒护锛涙敞鍐?disposer 浜よ繕 fiber锛屾彃浠跺嵏杞芥椂鍛戒护鑷姩娉ㄩ攢銆?|
| `cmdList(source, config, args)` | 鍑芥暟 | 瀹炵幇锛氭嫆缁濅换浣曞弬鏁帮紝鐒跺悗鎶?`JSON.stringify(source.list(), null, config.indent)` 鍐欏埌 stdout銆?|
| `UnitSource` | 绫诲瀷 | `Pick<DiscoveryService, 'list'>` 鈥斺€?瀹炵幇鎵€闇€鐨勬渶灏忕粨鏋勮鍥俱€?|
| `DEFAULT_INDENT` | 鏁板瓧锛?`2` 锛?| `indent` 鐨勭己鐪佸€硷紝schema 涓庣洿鎺ヨ皟鐢ㄥ叡鐢ㄣ€?|

## 寮€鍙?
```bash
pnpm --filter @veren/commander-list build
pnpm --filter @veren/commander-list test   # 4 涓敤渚?```

```
packages/commander/list
鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ list.ts        # Config schema + UnitSource + cmdList / 閰嶇疆 schema銆佹渶灏忚鍥句笌瀹炵幇
鈹?  鈹溾攢鈹€ tokens.ts      # 骞冲彴鏃犲叧鐨?INDENT 浠ょ墝 / platform-agnostic INDENT token
鈹?  鈹斺攢鈹€ index.ts       # 鎻掍欢妯″潡 name/inject/Config/apply 涓庡啀瀵煎嚭 / plugin module + re-exports
鈹斺攢鈹€ test/index.test.ts
```

## 娉ㄦ剰浜嬮」涓庣害鏉?
- `list` 鐙崰 stdout锛堢函 JSON锛夛紝AI 娑堣垂鏂瑰彲浠ョ洿鎺ヨВ鏋愩€?- 鍗曞厓娓呭崟鏉ヨ嚜 `@veren/commander-discovery` 鐨?`Discovery` 鏈嶅姟锛涘悓鐩綍涓?npm
  鍗曞厓浼樺厛浜?Rust crate銆?
