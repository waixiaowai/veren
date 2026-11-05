/**
 * 网页网关：插件的 Web 面，作为一个 `baiduPan` Remote 命名空间。刻意只做
 * 薄传输——每个远端方法转发一次 world 调用；领域错误折进业务返回值
 * （载体层 RemoteFailure 只有 gateway/* 码，BDPAN_* 稳定码上不了线）。
 * 浏览器那半在同一包的 `src/client/remote.ts` 镜像这些端点；签名一变，
 * 只有这一处需要跟着改。
 * The web gateway: the plugin's web surface, as a `baiduPan` Remote
 * namespace. Deliberately thin transport — each Remote method forwards one
 * world call; domain errors fold into the business result (the carrier's
 * RemoteFailure only carries gateway/* codes, so BDPAN_* codes cannot ride
 * the wire). The browser half mirrors these endpoints in this package's
 * `src/client/remote.ts`; a signature change has exactly one counterpart.
 *
 * @module @veren/baidu-pan/gateway
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { authorizeUrl } from './config.js'
import { commitTokens, signOut } from './credentials.js'
import { exchangeCodeForTokens } from './wire.js'
import { validateTokens } from './auth-flow.js'
import { BAIDU_PAN_WORLD_TOKEN, readWorld } from './service.js'
import { TransferJobRegistry, foldJobFailure, type JobFailure, type TransferJobSnapshot } from './jobs.js'
import { removeGuarded } from './manage-core.js'
import { displayPath, requirePath, resolveEntries } from './toolkit.js'
import { fileManage, fileMetas, listDir, makeDir, searchFiles } from './files-client.js'
import { createShare } from './share.js'
import { downloadFile } from './download.js'
import { uploadFile } from './upload.js'
import { baiduPanError, toErrorValue } from './errors.js'
import type { BaiduPanWorld } from './world.js'
import type { AccountProfile, FileEntry, QuotaSnapshot, ShareReceipt } from './types.js'
import {
  authStateView, foldOutcome, randomPassword, requireAbsoluteLocalPath, requireKeyword,
  type AuthStateView, type GatewayOutcome, type JobStartedView, type ListingView,
  type SignInStartView, type SignOutView,
} from './gateway-views.js'

/** 浏览器 contribution 引用的服务名。The service name the browser's contribution references. */
export const BAIDU_GATEWAY_NAME = 'baiduPanGateway'

/** 浏览器 contribution 挂载的线上命名空间。The wire namespace the browser's contribution mounts. */
export const BAIDU_REMOTE_NAMESPACE = 'baiduPan'

/** 列目录的取数上限（与工具面 list 的 1000 同值）。The listing fetch cap (the tool face list's 1000). */
const LIST_LIMIT = 1000

/**
 * 网页网关。world 由注入进来：apply 稍早提供，cordis 在就绪时解析。
 * The web gateway. The world arrives by injection: apply provides it a tick
 * earlier, and cordis resolves whenever ready.
 */
export class BaiduPanGatewayService extends TypertRemoteService {
  static inject = [BAIDU_PAN_WORLD_TOKEN]

  private readonly world: BaiduPanWorld
  private readonly jobs = new TransferJobRegistry()

  /**
   * @param ctx - the owning context / 属主上下文
   */
  constructor(ctx: Context) {
    super(ctx, BAIDU_GATEWAY_NAME, { namespace: BAIDU_REMOTE_NAMESPACE })
    this.world = readWorld(ctx)
  }

  /** 登录状态（本地读凭据，不出网）。The auth state (local credential read, no outbound call). */
  @Remote('authState')
  async authState(): Promise<GatewayOutcome<AuthStateView>> {
    return foldOutcome(() => authStateView(this.world))
  }

  /** 登录引导：授权页地址（用户打开后拿授权码）。The sign-in guide: the authorize URL (the user opens it and gets a code). */
  @Remote('beginSignIn')
  async beginSignIn(): Promise<GatewayOutcome<SignInStartView>> {
    return foldOutcome(async () => ({ url: authorizeUrl(this.world.config), expiresInMinutes: 10 }))
  }

  /** 粘贴授权码登录：换取 → 在线校验 → 落凭据库，坏码永不入库。Paste-code sign-in: exchange → online check → credential store; bad codes never commit. */
  @Remote('submitSignInCode')
  async submitSignInCode(request: { readonly code: string }): Promise<GatewayOutcome<AuthStateView>> {
    return foldOutcome(async () => {
      const code = request.code.trim()
      if (code.length === 0) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'code is required' })
      const tokens = await exchangeCodeForTokens(this.world.config, code)
      await validateTokens(this.world.config, tokens)
      await commitTokens(this.world.credentials, tokens)
      return authStateView(this.world)
    })
  }

  /** 注销：清除凭据记录。Signs out by deleting the credential record. */
  @Remote('signOut')
  async signOut(): Promise<GatewayOutcome<SignOutView>> {
    return foldOutcome(async () => {
      await signOut(this.world.credentials)
      return { signedOut: true }
    })
  }

  /** 账号资料。The account profile. */
  @Remote('whoami')
  async whoami(): Promise<GatewayOutcome<AccountProfile>> {
    return foldOutcome(() => this.world.client.profile())
  }

  /** 容量快照。The quota snapshot. */
  @Remote('quota')
  async quota(): Promise<GatewayOutcome<QuotaSnapshot>> {
    return foldOutcome(() => this.world.client.quota())
  }

  /** 列一个目录（排序/筛选在客户端做，取数一次拉满）。Lists one directory (sort/filter run client-side; one full fetch). */
  @Remote('list')
  async list(request: {
    readonly dir: string
    readonly folderOnly?: boolean
  }): Promise<GatewayOutcome<ListingView>> {
    return foldOutcome(async () => {
      const dir = requirePath(this.world, request.dir)
      const entries = await listDir(this.world.client, { dir, folderOnly: request.folderOnly, start: 0, limit: LIST_LIMIT })
      return { dir, entries }
    })
  }

  /** 关键字检索（服务端分页透传）。Keyword search (server paging passes through). */
  @Remote('search')
  async search(request: {
    readonly keyword: string
    readonly dir?: string
    readonly page?: number
    readonly num?: number
  }): Promise<GatewayOutcome<{ readonly total: number; readonly entries: readonly FileEntry[] }>> {
    return foldOutcome(async () => {
      const dir = request.dir === undefined ? undefined : requirePath(this.world, request.dir)
      return searchFiles(this.world.client, {
        keyword: requireKeyword(request.keyword),
        page: request.page,
        num: request.num,
        ...(dir === undefined ? {} : { dir }),
      })
    })
  }

  /** 新建目录（多级）。Creates a directory (multi-level). */
  @Remote('makeDir')
  async makeDir(request: { readonly path: string }): Promise<GatewayOutcome<{ readonly fsid: string; readonly path: string }>> {
    return foldOutcome(async () => makeDir(this.world.client, requirePath(this.world, request.path)))
  }

  /** 原地重命名（裸名，不含分隔符）。Renames in place (a bare name, no separators). */
  @Remote('rename')
  async rename(request: { readonly path: string; readonly newName: string }): Promise<GatewayOutcome<{ readonly path: string }>> {
    return foldOutcome(async () => {
      const source = requirePath(this.world, request.path)
      const newName = requirePath(this.world, request.newName, { singleName: true })
      await fileManage(this.world.client, 'rename', [{ path: source, newname: newName }])
      return { path: source }
    })
  }

  /** 复制/移动到目标目录（冲突失败不覆盖）。Copies/moves into a destination directory (conflicts fail, never overwrite). */
  @Remote('transfer')
  async transfer(request: {
    readonly op: 'copy' | 'move'
    readonly sourcePath: string
    readonly destDir: string
    readonly newName?: string
  }): Promise<GatewayOutcome<{ readonly path: string }>> {
    return foldOutcome(async () => {
      const source = requirePath(this.world, request.sourcePath)
      const destDir = requirePath(this.world, request.destDir)
      const entry: { path: string; dest: string; newname?: string } = { path: source, dest: destDir }
      if (request.newName !== undefined) entry.newname = requirePath(this.world, request.newName, { singleName: true })
      await fileManage(this.world.client, request.op, [entry])
      return { path: source }
    })
  }

  /** 守门删除：凭证恰好集合（共享核心，与 delete 工具同一份编排）。Guarded delete: exact voucher set (the shared core — one orchestration with the delete tool). */
  @Remote('remove')
  async remove(request: { readonly paths: readonly string[]; readonly confirmPaths: readonly string[] }): Promise<GatewayOutcome<{ readonly paths: readonly string[] }>> {
    return foldOutcome(async () => ({ paths: await removeGuarded(this.world, request.paths, request.confirmPaths) }))
  }

  /** 私密分享：链接与提取码透传服务端。Private share: link and password pass through from the server. */
  @Remote('share')
  async share(request: {
    readonly paths: readonly string[]
    readonly period?: number
    readonly password?: string
  }): Promise<GatewayOutcome<ShareReceipt>> {
    return foldOutcome(async () => {
      const entries = await resolveEntries(this.world, request.paths)
      return createShare(this.world.client, {
        fsids: entries.map(entry => entry.fsid),
        period: request.period ?? 7,
        password: request.password ?? randomPassword(),
      })
    })
  }

  /** 受理上传：立即回任务号，分片上传在后台跑。Accepts an upload: the job id returns at once; slicing runs in the background. */
  @Remote('startUpload')
  async startUpload(request: {
    readonly localPath: string
    readonly remotePath: string
    readonly overwrite?: boolean
  }): Promise<GatewayOutcome<JobStartedView>> {
    return foldOutcome(() => {
      const localPath = requireAbsoluteLocalPath(request.localPath)
      const remotePath = requirePath(this.world, request.remotePath)
      const jobId = this.jobs.start('upload', displayPath(remotePath), () => uploadFile(this.world.client, {
        localPath,
        remotePath,
        conflictPolicy: request.overwrite === true ? 'overwrite' : 'fail',
      }), foldGatewayError)
      return { jobId }
    })
  }

  /** 受理下载：立即回任务号，直链流式写在后台跑。Accepts a download: the job id returns at once; the dlink stream write runs in the background. */
  @Remote('startDownload')
  async startDownload(request: { readonly remotePath: string; readonly localPath: string }): Promise<GatewayOutcome<JobStartedView>> {
    return foldOutcome(async () => {
      const localPath = requireAbsoluteLocalPath(request.localPath)
      const remotePath = requirePath(this.world, request.remotePath)
      const meta = await downloadMeta(this.world, remotePath)
      const jobId = this.jobs.start('download', displayPath(remotePath), () => downloadFile(this.world.client, { meta, localPath }), foldGatewayError)
      return { jobId }
    })
  }

  /** 单个任务快照。One job's snapshot. */
  @Remote('job')
  async job(request: { readonly jobId: string }): Promise<GatewayOutcome<TransferJobSnapshot>> {
    return foldOutcome(async () => {
      const snapshot = this.jobs.snapshotOf(request.jobId)
      if (snapshot === undefined) throw baiduPanError('BDPAN_NOT_FOUND', { detail: `job ${request.jobId}` })
      return snapshot
    })
  }

  /** 全部任务快照（running 在前）。Every job's snapshot (running first). */
  @Remote('jobs')
  async jobs(): Promise<GatewayOutcome<{ readonly jobs: readonly TransferJobSnapshot[] }>> {
    return foldOutcome(async () => ({ jobs: this.jobs.list() }))
  }
}

/** 网关侧的任务失败折叠：规范错误值 → JobFailure（去 kind）。The gateway-side job failure fold: canonical error value → JobFailure (drops kind). */
function foldGatewayError(error: unknown): JobFailure {
  return foldJobFailure(toErrorValue(error))
}

/** 下载前的元数据解析：路径 → 条目 → filemetas（拿 dlink）。The pre-download metadata resolution: path → entry → filemetas (for the dlink). */
async function downloadMeta(world: BaiduPanWorld, remotePath: string) {
  const entries = await resolveEntries(world, [remotePath])
  const metas = await fileMetas(world.client, { fsids: [entries[0]?.fsid ?? ''] })
  const meta = metas[0]
  if (meta === undefined) throw baiduPanError('BDPAN_NOT_FOUND', { detail: remotePath })
  return meta
}
