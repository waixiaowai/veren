/**
 * 训练场领域的数据契约：常量与接口，只放类型与常量、不含行为。
 *
 * The training-ground domain's data contracts: constants and interfaces.
 * Types and constants only, no behavior.
 *
 * 行为实现按职责分布在 ground-paths / ground-meta / ground-create /
 * ground-remove / ground-list；本文件是它们共同引用的唯一类型来源，
 * 避免同一接口多处声明。
 *
 * Behavior lives in ground-paths / ground-meta / ground-create /
 * ground-remove / ground-list by responsibility; this file is the single
 * source every one of them imports, so no interface is ever duplicated.
 */

/** 训练场元数据文件名 / the training-ground metadata filename */
export const MARKER_FILENAME = '.veren-tests.json';

/** 密钥文件名 / the credentials filename */
export const CREDENTIALS_FILENAME = '.credentials.yaml';

/** 缺省 profile / the default profile */
export const DEFAULT_PROFILE = 'web';

/** 训练场根、源 DSH_HOME 与源码目录 / the training-ground root, source DSH home, and source checkout */
export interface TrainingPaths {
  /** 训练场根目录 / the training-ground root directory */
  root: string;
  /** 密钥来源 DSH_HOME / the DSH home that supplies credentials */
  sourceHome: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
  /** 目标 profile / the target profile */
  profile: string;
}

/** 插件配置中的原始路径字段，空串表示使用缺省值 / raw path fields; empty strings mean defaults */
export interface TrainingConfig {
  /** 训练场根目录 / training-ground root */
  root: string;
  /** 密钥来源 DSH_HOME / source DSH home */
  sourceHome: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
  /** 目标 profile / target profile */
  profile: string;
}

/** 指向一个已存在训练场的最小结构视图 / the minimal view of an existing training ground */
export interface TrainingGroundRef {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径（DSH_HOME）/ the absolute path (DSH_HOME) */
  path: string;
  /** profile 名 / the profile name */
  profile: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
}

/** 启动训练场的选项 / options for starting a training ground */
export interface StartTrainingGroundOptions {
  /** web 端口 / the web port */
  port: number;
  /** 是否打开浏览器 / whether to open a browser */
  open: boolean;
}

/** 训练场元数据 / training-ground metadata */
export interface TrainingGroundMeta {
  /** 元数据版本 / metadata version */
  version: 1;
  /** 训练场名 / the training-ground name */
  name: string;
  /** ISO 创建时间 / ISO creation time */
  createdAt: string;
  /** 源 DSH_HOME / the source DSH home */
  sourceHome: string;
  /** 复制模型配置的源 profile / the source profile the model configuration came from */
  sourceProfile: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
  /** 目标 profile / the target profile */
  profile: string;
}

/** 列表/详情使用的训练场摘要 / the training-ground summary used by list and show */
export interface TrainingGroundSummary {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径 / the absolute path */
  path: string;
  /** 是否由本命令创建（有元数据）/ whether this command created it (metadata present) */
  managed: boolean;
  /** 目标 profile / the target profile */
  profile: string;
  /** 源 DSH_HOME，未托管时为 null / source DSH home, null when unmanaged */
  sourceHome: string | null;
  /** 源 profile，未托管时为 null / source profile, null when unmanaged */
  sourceProfile: string | null;
  /** ISO 创建时间，未托管时为 null / ISO creation time, null when unmanaged */
  createdAt: string | null;
  /** 是否已复制密钥 / whether credentials exist */
  hasCredentials: boolean;
  /** profile 是否已初始化 / whether the profile is initialized */
  hasProfile: boolean;
}

/** 创建结果 / the creation result */
export interface CreateTrainingGroundResult {
  /** 是否只做预检 / whether this was a dry run */
  dryRun: boolean;
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径 / the absolute path */
  path: string;
  /** 目标 profile / the target profile */
  profile: string;
  /** 模型配置来源 profile，未复制时为 null / the source profile for model config, null when not copied */
  sourceProfile: string | null;
  /** 源 DSH_HOME / the source DSH home */
  sourceHome: string;
  /** 已复制的配置项 / copied configuration items */
  copied: string[];
  /** 非致命警告 / non-fatal warnings */
  warnings: string[];
}

/** 创建选项 / creation options */
export interface CreateTrainingGroundOptions extends TrainingPaths {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 指定模型配置来源 profile；省略时自动探测 / explicit model source profile; auto-detected when omitted */
  sourceProfile?: string;
  /** 只预检，不写磁盘 / validate only, write nothing */
  dryRun?: boolean;
}

/** 创建所需的注入能力 / injected capabilities required by creation */
export interface CreateTrainingGroundDeps {
  /** 通过 dsh 初始化目标 profile / initialize the target profile through dsh */
  initProfile(ground: TrainingGroundRef): Promise<void>;
  /** 时钟，测试可替换 / clock, replaceable in tests */
  now?: () => Date;
}

/** 清理选项 / removal options */
export interface RemoveTrainingGroundOptions {
  /** 训练场根目录 / the training-ground root */
  root: string;
  /** 训练场名 / the training-ground name */
  name: string;
  /** 用户是否已明确授权删除 / whether the user explicitly authorized deletion */
  yes: boolean;
  /** 是否允许删除没有元数据的目录 / whether unmanaged directories may be removed */
  force: boolean;
  /** 只预检 / dry run */
  dryRun: boolean;
  /** 当前进程的 DSH_HOME，禁止删除 / the current DSH_HOME, which must never be removed */
  currentHome?: string;
}

/** 清理结果 / the removal result */
export interface RemoveTrainingGroundResult {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径 / the absolute path */
  path: string;
  /** 是否实际删除（dry run 为 false）/ whether it was removed (false on a dry run) */
  removed: boolean;
}
