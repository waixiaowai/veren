/**
 * 共享类型定义：平台枚举、采集模式、保存介质、启动参数与统一实体。
 * Shared type definitions: platform enums, crawler modes, save options,
 * command args, and the unified record entities.
 *
 * 只放类型与闭集枚举，不放任何运行时逻辑；行为见各领域文件。
 * Types and closed-set unions only; no runtime logic lives here.
 *
 * @module @veren/crawler/types
 */

/** 目标内容平台标识 / target content platform identifiers */
export type Platform = 'xhs' | 'dy' | 'ks' | 'bili' | 'wb' | 'tieba' | 'zhihu'

/** 采集模式 / crawling modes */
export type CrawlerType = 'search' | 'detail' | 'creator'

/** 登录方式 / login methods */
export type LoginType = 'qrcode' | 'phone' | 'cookie'

/**
 * 存储介质：仅宿主 storageDomain（用户指令：文件/数据库介质归 dsh 其他
 * 插件；design 原八介质枚举由宿主存储生态承接）。
 * Storage medium: the host storageDomain only (directive: file/database
 * media belong to other dsh plugins; the design's eight-media enum is
 * carried by the host storage ecosystem).
 */

/** 代理服务商枚举 / proxy provider names */
export type ProxyProviderName = 'kuaidaili' | 'wandouhttp' | 'static'

/**
 * 采集任务启动参数（启动器契约，见 design/modules/launcher.md）。
 * Crawl task launch arguments (launcher contract, see design/modules/launcher.md).
 */
export interface CommandArgs {
  /** 目标平台 / target platform */
  platform: Platform
  /** 登录方式 / login method */
  loginType: LoginType
  /** 采集模式 / crawling mode */
  crawlerType: CrawlerType
  /** search 模式关键词 / keywords for search mode */
  keywords: string[]
  /** detail 模式目标内容 id 列表 / content ids for detail mode */
  specifiedId: string[]
  /** creator 模式创作者标识列表 / creator ids for creator mode */
  creatorId: string[]
  /** 起始页码 / starting page number */
  startPage: number
  /** 是否抓取一级评论 / whether to fetch first-level comments */
  getComment: boolean
  /** 是否抓取二级评论 / whether to fetch sub-comments */
  getSubComment: boolean
  /** 是否下载媒体文件 / whether to download media files */
  getMedia: boolean
  /** cookie 登录凭证串 / cookie credential string for cookie login */
  cookies: string | null
  /** 无头浏览器 / headless browser */
  headless: boolean
  /** 内容数量上限 / max note count */
  crawlerMaxNotesCount: number
  /** 单条内容评论上限 / max comments per note */
  maxCommentsCountSingleNotes: number
  /** 并发信号量 / concurrency semaphore */
  maxConcurrencyNum: number
  /** 是否启用 IP 代理 / whether to enable IP proxy */
  enableIpProxy: boolean
  /** 代理池数量 / proxy pool count */
  ipProxyPoolCount: number
  /** 代理服务商 / proxy provider name */
  ipProxyProviderName: ProxyProviderName
  /** 静态代理地址 / static proxy url */
  staticProxyUrl: string | null
}

/**
 * 统一内容实体（整形后，字段全集见 design/data.md）。
 * Unified content record (shaped; full field list in design/data.md).
 */
export interface ContentRecord {
  /** 平台业务主键 / platform business key */
  id: string
  /** 标题 / title */
  title: string | null
  /** 正文描述 / description */
  desc: string | null
  /** 完整访问地址（平台适用时含令牌）/ full access url (token included when applicable) */
  url: string
  /** 发布时间（Unix 毫秒或平台格式）/ publish time (unix ms or platform format) */
  publishTime: string | null
  /** 互动计数 / interaction counters */
  likedCount: number | null
  commentCount: number | null
  collectedCount: number | null
  shareCount: number | null
  /** 图片地址串（逗号分隔）/ image url list (comma separated) */
  imageList: string
  /** 视频地址 / video url */
  videoUrl: string | null
  /** 标签串（逗号分隔）/ tag list (comma separated) */
  tagList: string
  /** 采集来源关键词 / source keyword */
  sourceKeyword: string | null
  /** 匿名哈希（人物标识脱敏）/ anonymized creator hash */
  creatorHash: string
  /** 遮蔽昵称 / masked nickname */
  nickname: string
  /** 写入时刻 / created-at unix ms */
  addTs: number
  /** 最后修改时刻 / last-modified unix ms */
  lastModifyTs: number
}

/**
 * 统一评论实体（整形后）。
 * Unified comment record (shaped).
 */
export interface CommentRecord {
  /** 评论业务主键 / comment business key */
  id: string
  /** 归属内容主键 / owning content key */
  contentId: string
  /** 二级评论指向一级评论 id / parent comment id for sub-comments */
  parentCommentId: string | null
  /** 评论正文 / comment body */
  content: string
  /** 点赞数 / like count */
  likeCount: number | null
  /** 子评论数 / sub-comment count */
  subCommentCount: number | null
  /** 评论图片地址串 / comment picture url list */
  pictures: string | null
  /** 发布时间 / publish time */
  publishTime: string | null
  /** 来源关键词 / source keyword */
  sourceKeyword: string | null
  /** 匿名哈希 / anonymized creator hash */
  creatorHash: string
  /** 遮蔽昵称 / masked nickname */
  nickname: string
  /** 写入时刻 / created-at unix ms */
  addTs: number
  /** 最后修改时刻 / last-modified unix ms */
  lastModifyTs: number
}

/** 采集任务状态（控制服务视角，见 design/states.md）/ crawler task states */
export type CrawlerTaskState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

/** 登录会话状态（登录凭证视角，见 design/states.md）/ login session states */
export type LoginSessionState =
  | 'unknown'
  | 'logging_in'
  | 'waiting_scan'
  | 'logged_in'
  | 'expired'
  | 'failed'
