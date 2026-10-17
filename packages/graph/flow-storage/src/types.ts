/**
 * @deepseek-ai/dsh-graph-flow-storage 的类型面：插件配置、领域记录与表句柄。
 * 只放类型；域声明、存储实现与 schemastery schema 在各自源文件里。
 *
 * Type surface of @deepseek-ai/dsh-graph-flow-storage: the plugin config, the
 * domain records and the table handles. Types only; the domain declaration,
 * storage implementation and schemastery schema live in their own files.
 */

export type { Config } from './index.js';
export type { FlowRecord, RunRecord } from './domain.js';
export type { FlowDomainTables } from './storage.js';
