/**
 * 训练场领域的公共出口（薄 re-export）。
 *
 * Public barrel of the training-ground domain (thin re-exports).
 *
 * 原单文件实现已按职责拆分为以下模块；本文件只做转发，保持
 * `./ground.js` / `../src/ground` 等既有导入路径稳定：
 *
 * The former single-file implementation is now split by responsibility into
 * the modules below; this file only forwards so existing import paths such as
 * `./ground.js` / `../src/ground` keep working:
 *
 *   - ground-types  数据契约（常量与接口）/ data contracts (constants and interfaces)
 *   - ground-fs     文件系统与路径小工具 / filesystem and path helpers
 *   - ground-paths  路径解析与安全校验 / path resolution and safety checks
 *   - ground-meta   元数据读取与校验 / metadata reading and validation
 *   - ground-create 创建 / creation
 *   - ground-remove 删除 / removal
 *   - ground-list   发现与检视 / discovery and inspection
 */

export * from './ground-fs.js';
export * from './ground-types.js';
export * from './ground-paths.js';
export * from './ground-meta.js';
export * from './ground-create.js';
export * from './ground-remove.js';
export * from './ground-list.js';
