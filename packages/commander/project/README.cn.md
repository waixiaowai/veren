# @veren/commander-project

[English](./README.md)

鎶?veren 椤圭洰淇℃伅鍙樻垚 Cordis 鏈嶅姟锛氬悜涓婃煡鎵?`.veren.yaml` 瀹氫綅椤圭洰鏍癸紝缁?`@veren/yaml-parser` 鏈嶅姟鍔犺浇 `scan` 閰嶇疆锛屽苟浠?`Project` 浠ょ墝鎻愪緵 `{ root, config }`銆?
## 浣曟椂浣跨敤

- Cordis 鎻掍欢闇€瑕侀」鐩牴鎴栧崟鍏冩壂鎻忔牴 鈥斺€?娉ㄥ叆 `Project`锛屼笉瑕佽嚜琛岄噸璇?`.veren.yaml`銆?- 浣犲湪鑷繁鐨勫伐鍏蜂腑鍔犺浇 veren 椤圭洰閰嶇疆锛屼笖甯屾湜 YAML 瑙ｆ瀽鑳藉姏鏉ヨ嚜涓婁笅鏂囥€?
濡傛灉瑙ｆ瀽鐨勬槸鑷繁鐨勯厤缃牸寮忥紝璇疯烦杩囨湰鍖呫€?
## 瀹夎

```json
{
  "dependencies": {
    "@veren/commander-project": "workspace:*"
  }
}
```

杩愯鏃朵笂涓嬫枃蹇呴』宸叉彁渚?`@veren/yaml-parser` 鏈嶅姟锛坄verenYamlParser`锛夛紝鏈彃浠跺凡閫氳繃
`inject` 澹版槑璇ヤ緷璧栥€?
## 蹇€熷紑濮?
```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'
import { Project, ProjectPlugin } from '@veren/commander-project'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(ProjectPlugin) // 浠?cwd 瀹氫綅椤圭洰鏍瑰苟鍔犺浇 .veren.yaml

const project = ctx.get(Project.name)! // { root: '/鈥?, config: { scanRoots: ['/鈥?apps', 鈥 } }
```

`scan` 缂虹渷鍥為€€ `['apps', 'packages', 'cargos']`锛堢浉瀵?`.veren.yaml`锛夛紱瀛樺湪鏃跺繀椤绘槸
瀛楃涓叉暟缁勶紝鎵弿鏍逛笉瀛樺湪浼氭姏閿欍€?
## 鎺ュ彛

| 瀵煎嚭 | 绫诲瀷 | 璇存槑 |
| --- | --- | --- |
| `Project` | 浠ょ墝锛屽瓧绗︿覆 `'verenCliProject'` | 椤圭洰淇℃伅鏈嶅姟娉ㄥ唽鍒扮殑浠ょ墝銆?|
| `ProjectInfo` | 鎺ュ彛 | `{ root, config }` 鈥斺€?`.veren.yaml` 鎵€鍦ㄧ洰褰曚笌瑙ｆ瀽鍚庣殑閰嶇疆銆?|
| `ProjectPlugin` | 鎻掍欢瀵硅薄 | 瀹氫綅鏍广€佸姞杞介厤缃€佹彁渚?`Project`锛沗inject = ['verenYamlParser']`銆?|
| `findProjectRoot(startDir?)` | 鍑芥暟 | 浠?`startDir`锛堥粯璁?cwd锛夊悜涓婃煡鎵?`.veren.yaml` 鎵€鍦ㄧ洰褰曪紱缂哄け鏃舵姏 `CliError`銆?|
| `loadConfig(root, ctx)` | 鍑芥暟 | 缁?YAML 瑙ｆ瀽鏈嶅姟瑙ｆ瀽 `.veren.yaml`锛沗scan` 缂虹渷鍥為€€ `DEFAULT_SCAN_ROOTS`锛岀被鍨嬩笉鍚堟硶鎴栨壂鎻忔牴缂哄け鎶涢敊銆?|
| `CONFIG_FILE` / `DEFAULT_SCAN_ROOTS` | 甯搁噺 | `'.veren.yaml'` / `['apps', 'packages', 'cargos']`銆?|
| `Config` | 鎺ュ彛 | `{ scanRoots: string[] }`锛堢粷瀵硅矾寰勶級銆?|

## 寮€鍙?
```bash
pnpm --filter @veren/commander-project build
pnpm --filter @veren/commander-project test   # 7 涓敤渚?```

```
packages/commander/project
鈹溾攢鈹€ src/project.ts     # 椤圭洰鏍瑰畾浣?+ 閰嶇疆鍔犺浇 + Project 鏈嶅姟 / root discovery + config + service
鈹溾攢鈹€ src/index.ts       # 鍐嶅鍑?/ re-exports
鈹斺攢鈹€ test/index.test.ts
```

## 娉ㄦ剰浜嬮」涓庣害鏉?
- `findProjectRoot` 榛樿浠?`process.cwd()` 寮€濮嬶紱璇峰湪 veren 椤圭洰鍐呰繍琛?CLI锛屾垨鏄惧紡
  浼犲叆璧峰鐩綍銆?- 涓婁笅鏂囩己灏?YAML 瑙ｆ瀽鏈嶅姟鏃讹紝`.veren.yaml` 瑙ｆ瀽浼氱粡 `getOrThrow` 绔嬪嵆澶辫触銆?
