---
title: 平台爬取器
description: 七平台统一骨架的采集执行主体，含浏览器自动化与签名生成。
sidebar:
  order: 22
  label: 平台爬取器
lastUpdated: 2026-11-04
---

平台爬取器（核心域）：以统一骨架执行单个平台的搜索、详情、创作者三种采集模式，覆盖分页推进、签名参数生成、限频退避与数据生产；它是全部采集能力的执行主体，与登录与凭证模块的分界是「爬取器只调用凭证，不管理凭证」，与存储适配模块的分界是「爬取器只生产内存数据，不触碰落地介质」。

## 1. Responsibilities

- 按平台标识实现统一入口：启动浏览器 → 校验登录 → 按模式分发采集 → 清理资源。
- 三种采集模式：关键词搜索、指定内容详情、创作者主页作品。
- 评论采集作为内容采集的伴随动作，由开关控制一级与二级评论。
- 签名参数生成：每平台按各自机制产出请求所需的签名头或参数。
- 分页推进：页码、游标、会话串联三种翻页形态，数量上限与起始页可控。
- 限频与退避：固定间隔、并发信号量、重试与代理刷新协同。
- 浏览器自动化：CDP 接管用户已装浏览器与标准 Playwright 启动双模式，含隐身脚本注入与登录态持久化目录。

功能清单：七平台（xhs、dy、ks、bili、wb、tieba、zhihu）× 三模式 × 评论伴随采集；协作对象为登录与凭证（探测与登录）、存储适配（数据回吐）、媒体下载（媒体地址交出）、代理池（出口 IP）。

## 2. Key Design Decisions

铁律级设计决策，违反后果随条注明：

1. **双模式浏览器，CDP 优先**：默认接管使用者已装的浏览器（远程调试端口连接），可切换为标准启动。违反后果：丢失真实浏览器指纹，风控拒绝率显著上升。
2. **每请求先刷新代理再签名**：代理到期切换发生在签名之前，保证签名与出口 IP 会话一致。违反后果：签名会话与 IP 不匹配触发风控。
3. **信号量约束一切并发任务**：详情与评论并发度全部由同一配置控制（默认 1）。违反后果：并发失控直接触发平台限频与封禁。
4. **页间固定限频间隔**：每页、每详情、每评论批次后固定休眠。违反后果：请求节奏失配，采集中断。
5. **数据只生产不落地**：爬取器把整形后的结构化数据交给存储适配，自身不写任何介质。违反后果：数据变更权分散，介质切换失效。

## 3. Contracts

```ts
// 统一爬取器契约，七平台各自实现
abstract class AbstractCrawler {
  abstract start(): Promise<void>;
  abstract search(): Promise<void>;
  abstract launchBrowser(chromium: BrowserType, playwrightProxy: ProxyConfig | null,
    userAgent: string | null, headless: boolean): Promise<BrowserContext>;
  // CDP 模式启动；未实现的平台回退标准启动
  async launchBrowserWithCdp(playwright: Playwright, playwrightProxy: ProxyConfig | null,
    userAgent: string | null, headless: boolean): Promise<BrowserContext> {
    return this.launchBrowser(playwright.chromium, playwrightProxy, userAgent, headless);
  }
}

// 接口客户端契约：请求与 Cookie 同步
abstract class AbstractApiClient {
  abstract request(method: string, url: string, kwargs: RequestOptions): Promise<ApiResponse>;
  abstract updateCookies(context: BrowserContext): Promise<void>;
}

// 采集任务上下文（进程内全局）
interface CrawlerContext {
  requestKeyword: ContextVar<string>;   // 当前关键词，评论请求回传用
  crawlerType: ContextVar<CrawlerType>;
  sourceKeyword: ContextVar<string>;    // 数据来源关键词，随数据入库
}

interface ContentItem {          // 整形后的内容实体，字段见数据字典
  id: string;
  title: string | null;
  desc: string | null;
  url: string;
  publishTime: number | null;
  likedCount: number | null;
  commentCount: number | null;
  mediaList: MediaRef[];
  sourceKeyword: string | null;
  creatorHash: string;           // 已脱敏
}
```

签名机制按平台分四种路线，统一以「输入请求要素 → 输出签名头/参数」的签名器抽象收敛：

```ts
interface SignResult {
  headers: Record<string, string>;  // 追加到请求头的签名字段
  params: Record<string, string>;   // 追加到请求参数的签名字段
}
type SignProvider = (method: string, uri: string, payload: PayloadContext) => Promise<SignResult>;
```

| 平台 | 签名路线 | 产出 |
| --- | --- | --- |
| xhs | 本地纯算法库 | 签名头四件套（时间戳、签名、公共头、追踪 id） |
| dy | 本地引擎执行签名脚本 | 请求参数级签名 |
| zhihu | 本地引擎执行签名脚本 | 两个签名头，依赖登录 Cookie 中的会话键 |
| bili | 纯算法 WBI 签名 | 参数级签名（查询串加盐摘要） |
| ks | 浏览器内捕获签名环境执行 | 查询参数级签名 |
| wb、tieba | 无加密签名 | Cookie 会话即可；tieba 另有令牌参数与浏览器内取数通道 |

翻页形态三种：页码（多数平台搜索与创作者列表）、游标（各平台评论、抖音创作者、微博正文、B 站动态）、会话串联（部分平台搜索需要上一页响应中的会话 id 串联）。每页固定条数因平台而异，翻页终止条件统一为「游标耗尽或累计条数达到配置上限」。

## 4. Flow

主流程伪代码覆盖登录探测、模式分发、翻页、限频与失败分支。

```ts
// 用途：表达统一骨架与失败分支
async function start(crawler: AbstractCrawler): Promise<void> {
  const pool = maybeInitProxyPool();                    // 代理开关关闭时为 null
  const context = await crawler.launchBrowserWithCdpOrStandard(pool);
  await context.newPage().goto(platformIndexUrl);
  const client = createApiClient(context, pool);        // 从浏览器提取 Cookie 组装请求头
  if (!(await client.pong())) {                         // 登录探测失败
    const login = createLogin(context, config.loginType);
    await login.begin();                                // 失败分支见登录与凭证模块
    await client.updateCookies(context);
  }
  const type = crawlerType.get();
  if (type === "search") await crawler.search();
  else if (type === "detail") await crawler.detail();
  else await crawler.creator();
  await cleanup(context);
}

// 搜索模式核心循环：翻页、去重、伴随采集
async function search(crawler: AbstractCrawler): Promise<void> {
  for (const keyword of keywords) {
    let cursor = initCursor(config.startPage);
    let fetched = 0;
    while (fetched < config.maxNotesCount) {
      const page = await retryable(() =>
        crawler.fetchPage(keyword, cursor), onRateLimited); // 失败分支见下
      if (page.items.length === 0) break;                   // 空页终止
      for (const item of page.items) {
        if (fetched >= config.maxNotesCount) break;
        await semaphore.run(async () => {                   // 信号量约束并发
          const detail = await fetchDetailOrFallback(item); // 接口失败降级页面解析
          await store.saveContent(detail);                  // 只交给存储适配
          if (config.getMedia) await downloadMedia(detail); // 旁路：失败仅记日志
          if (config.getComments) await enqueueComments(detail);
        });
        fetched += 1;
      }
      if (!page.hasMore) break;
      cursor = page.next;
      await sleep(config.crawlerMaxSleepSec);               // 固定限频间隔
    }
  }
  await drainCommentTasks();                                // 等待全部评论任务完成
}
```

失败分支与恢复策略：

- **限频与风控**：平台特定错误被分类为限频/封禁/内容不存在三类。限频触发指数退避重试（重试次数与间隔各平台自定），部分平台在风控时取消未完成的评论任务、阻塞等待后刷新 Cookie 再续；封禁类错误直接上抛终止当前关键词。
- **签名失效**：表现为统一的未授权响应，恢复路径是回到登录探测（见登录与凭证模块），Cookie 刷新后重试；重试耗尽上抛。
- **详情接口失败**：降级为浏览器页面解析兜底（页面内嵌初始状态数据），仍失败则跳过该条并记日志，不中断批次。
- **单条任务失败隔离**：详情与评论任务在并发任务组内各自捕获异常，单条失败不影响同批其余任务；任务组在批次结束处汇合等待。
- **幂等**：采集进程可安全重跑——落地介质侧按业务主键存在即更新（见存储适配模块），重复采集不会产生重复记录。

## 5. Platform Differences

七平台在统一骨架下的差异清单，设计上以「共享骨架 + 平台实现」收敛：

- **xhs**：详情接口依赖搜索结果带出的访问令牌，缺失时无法取详情；令牌随内容数据一并入库供后续复用；海外版域名可切换。
- **dy**：详情请求需要成套的风控参数（设备指纹 Cookie 与验证参数），签名由本地脚本引擎执行；评论请求需回传来源关键词上下文。
- **ks**：签名环境从页面运行时捕获；唯一在固定间隔外叠加随机抖动的平台；被风控时阻塞等待并取消全部评论任务后刷新 Cookie 续采。
- **bili**：签名密钥取自页面本地存储；支持按日期区间逐日构造搜索窗口并设每日采集上限；登录后二次探测失败即退出（避免静默降画质）；媒体下载支持音视频分轨合流与画质逐档降级。
- **wb**：双站 Cookie（桌面登录、移动端取数）；无加密签名；正文有长文截断，需逐条取全文补齐；遭遇风控响应时自动回浏览器首页刷新 Cookie 重试。
- **tieba**：无加密签名但需要会话令牌；大量数据经浏览器内执行取回或 HTML 解析；启动时经真实导航路径进入以规避安全验证；搜索模式额外按吧名采集吧内帖子列表。
- **zhihu**：签名依赖登录 Cookie 中的会话键；登录后必须先进入一次搜索页取得搜索 Cookie 才能调用搜索接口；内容按问答、文章、视频三类分发详情接口。

## 6. Acceptance

1. **成功路径**：给定平台与合法关键词，搜索模式在数量上限或游标耗尽后正常结束，数据经存储适配落地，日志含每页抓取记录。
2. **拒绝路径**：登录探测失败且登录流程被放弃时，进程不以未登录状态发出任何业务请求，日志给出凭证失败原因并以错误退出。
3. **失败恢复**：模拟限频响应，爬取器按重试策略退避后成功续采；重试耗尽时该关键词终止且已采数据完整保留。
4. **隔离路径**：单条详情降级失败或单条评论任务异常时，同批其余条目照常采集，日志含失败条目标识。
5. **幂等路径**：同一关键词连续两次采集，落地介质中无重复记录，互动计数类字段被更新而非重复插入。
6. **数量上限**：设置上限为 N 时，任何平台采集累计不超过 N 条内容即终止翻页。
