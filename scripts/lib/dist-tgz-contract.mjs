/**
 * Manifest-contract checks for delivered tarballs (consumed by
 * verify-dist-tgz.mjs): a runtime entry must exist and live under dist, a
 * bundle's `dsh.bundle.patch` file must be inside the package, and first-party
 * dependencies must be registry-resolvable ranges — or, under `--offline`,
 * sibling `file:` rewrites whose targets exist.
 *
 * 交付 tarball 的清单契约检查（供 verify-dist-tgz.mjs 使用）：运行时入口必须
 * 存在且落在 dist；组合包的 `dsh.bundle.patch` 文件必须在包内；第一方依赖必须
 * 是 registry 可解析区间——`--offline` 下则为目标存在的兄弟 `file:` 改写。
 *
 * @module @veren/scripts/lib/dist-tgz-contract
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { entryOf } from './packed-tarball.mjs'

/**
 * 第一方依赖口径：默认要求 registry 可解析；`--offline` 要求兄弟 file: 且目标
 * 存在。返回问题列表。
 * First-party dependency contract: registry-resolvable by default; with
 * `--offline`, sibling file: targets that exist. Returns the problem list.
 *
 * @param {object} manifest - the installed manifest / 安装形态清单
 * @param {boolean} offline - whether the offline contract applies / 是否按 offline 口径
 * @returns {string[]} problems / 问题列表
 */
function dependencyProblems(manifest, offline) {
  const problems = []
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@veren/')) continue
      if (offline) {
        if (!spec.startsWith('file:')) {
          problems.push(`${section} ${name} is "${spec}", not a file: rewrite — offline tarballs must point at sibling tarballs`)
          continue
        }
        if (!existsSync(spec.slice('file:'.length))) {
          problems.push(`${section} ${name} points at a missing tarball: ${spec}`)
        }
      } else if (/^(file|workspace|link):/.test(spec)) {
        problems.push(`${section} ${name} is "${spec}" — deliverable tarballs must resolve from the registry`)
      }
    }
  }
  return problems
}

/**
 * 配置型组合包（无运行时入口）的交付事实：patch 文件在包内、成员依赖满足口径。
 * Delivery facts of a configuration-only bundle (no runtime entry): the patch
 * file is inside the package and member deps meet the contract.
 *
 * @param {object} manifest - the installed manifest / 安装形态清单
 * @param {string} dir - installed package directory / 安装目录
 * @param {boolean} offline - whether the offline contract applies / 是否按 offline 口径
 * @returns {string[]} problems / 问题列表
 */
function bundleProblems(manifest, dir, offline) {
  const problems = []
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    problems.push('no runtime entry and no dsh.bundle.patch — nothing for a profile to load')
  } else if (!existsSync(join(dir, patch.replaceAll('./', '')))) {
    problems.push(`dsh.bundle.patch file "${patch}" is missing from the package`)
  }
  problems.push(...dependencyProblems(manifest, offline))
  return problems
}

/**
 * 带运行时入口的包的交付事实：入口存在于包内且落在 dist。
 * Delivery facts of a package with a runtime entry: the entry exists inside
 * the package and lives under dist.
 *
 * @param {object} manifest - the installed manifest / 安装形态清单
 * @param {string} dir - installed package directory / 安装目录
 * @returns {string[]} problems / 问题列表
 */
function entryProblems(manifest, dir) {
  const problems = []
  const entry = entryOf(manifest)
  const entryFile = join(dir, entry.replaceAll('./', ''))
  if (!existsSync(entryFile)) {
    problems.push(`entry "${entry}" is missing from the package`)
  } else if (!entryFile.replaceAll('\\', '/').includes('/dist/')) {
    problems.push(`entry "${entry}" resolves outside dist — src cannot load from node_modules`)
  }
  return problems
}

/**
 * 清单自身的交付事实断言，按有无运行时入口分派 / assert the manifest's
 * delivery facts, dispatched by whether a runtime entry exists.
 *
 * @param {object} manifest - the installed manifest / 安装形态清单
 * @param {string} dir - installed package directory / 安装目录
 * @param {boolean} offline - whether the offline contract applies / 是否按 offline 口径
 * @returns {string[]} problems / 问题列表
 */
export function manifestProblems(manifest, dir, offline) {
  return entryOf(manifest) === null
    ? bundleProblems(manifest, dir, offline)
    : entryProblems(manifest, dir)
}
