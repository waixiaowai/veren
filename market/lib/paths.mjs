/**
 * 索引源工程内的固定路径与公开地址 / Fixed paths and the public URL of the index-source workspace.
 * 只放常量与解析逻辑，不做 I/O / Constants and resolution only, no I/O.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** market/ 目录 / The market/ directory. */
export const MARKET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 仓库根目录 / The repository root. */
export const ROOT_DIR = resolve(MARKET_DIR, '..')

/** 生成产物目录，整个目录会被部署 / Generated output; the whole directory is deployed. */
export const SITE_DIR = resolve(MARKET_DIR, 'site')

/** 源清单与市场元数据 / Source list and market metadata. */
export const SOURCES_FILE = resolve(MARKET_DIR, 'sources.txt')
export const MARKET_CONFIG_FILE = resolve(MARKET_DIR, 'market.json')

/** 索引对外地址，相对图标按它解析 / Public index URL; relative icons resolve against it. */
export const PUBLIC_INDEX_URL = 'https://market.veren.top/index.json'

/** 私有 npm 源，版本记录进 source.registry / Private npm registry, recorded in each version's source.registry. */
export const REGISTRY = 'https://npm.veren.top/'

/** DSH 检出目录，复用其中的索引生成器与校验器 / DSH checkout whose index generator and validator are reused. */
export const HARNESS_DIR = resolve(ROOT_DIR, process.env.DSH_HARNESS_DIR ?? 'deepseek/deepseek-harness')

/** 生成器入口：tsx CLI 与生成器源码入口 / Generator entry points: the tsx CLI and the generator source entry. */
export const TSX_CLI = resolve(HARNESS_DIR, 'node_modules/tsx/dist/cli.mjs')
export const GENERATOR_BIN = resolve(HARNESS_DIR, 'apps/plugin-market-generator/src/bin.ts')

/** 校验器构建产物，和索引格式同源 / Built validator, the same source the index format defines. */
export const VALIDATOR = resolve(HARNESS_DIR, 'packages/util/plugin-market-index/lib/types/index.js')
