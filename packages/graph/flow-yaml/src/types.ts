/**
 * @deepseek-ai/dsh-graph-flow-yaml 的类型面：插件配置、加载能力与校验错误。
 * 只放类型；加载实现与 schemastery schema 在 index.ts / loader.ts。
 *
 * Type surface of @deepseek-ai/dsh-graph-flow-yaml: the plugin config, the
 * loader capability and the validation error. Types only; the loader
 * implementation and schemastery schema live in index.ts / loader.ts.
 */

export type { Config, FlowYamlLoader } from './index.js';
export type { YamlFlowError } from './loader.js';
