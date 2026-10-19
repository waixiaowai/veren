/**
 * CLI 组装层：装载本应用的插件清单�? *
 * The CLI assembly layer: installs this application's plugin manifest.
 *
 * 「一切皆插件」：本模块只做组合，不实现能�?—�?能力插件在前，命令插件在�? * （cordis 本身�?inject 自动等待，顺序仅为可读性）。新增命�?= 写一个命令插�? * （参�?packages/commander/* 各包）并加入下方清单�? *
 * "Everything is a plugin": this module only composes and implements nothing �? * capability plugins first, command plugins after (cordis waits on inject
 * dependencies automatically; the order is for readability). To add a command,
 * write a command plugin (see the packages under packages/commander/*) and add
 * it to the manifest below.
 */

import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import * as BuildCommand from '@veren/commander-build';
import * as CliCommands from '@veren/commander-core';
import * as Discovery from '@veren/commander-discovery';
import * as DocCommand from '@veren/commander-doc';
import * as HelpCommand from '@veren/commander-help';
import * as ListCommand from '@veren/commander-list';
import * as Project from '@veren/commander-project';
import * as TestsCommand from '@veren/commander-tests';
import * as YamlParser from '@veren/yaml-parser';

/**
 * 创建运行时：依次装载插件清单�? * Creates the runtime by installing the plugin manifest in order.
 */
export async function createRuntime(): Promise<Context> {
  const ctx = new Context();

  // 能力插件 / capability plugins
  await ctx.plugin(YamlParser); // YAML 解析服务�?veren.yaml�? the YAML parsing service (.veren.yaml)
  new LocalFileSystem(ctx, LocalFileSystem.Config({})); // dsh-fs 本地后端：注�?ctx.fs / the dsh-fs local backend: registers ctx.fs
  await ctx.plugin(CliCommands); // 命令注册�?/ the command registry
  await ctx.plugin(Project); // 项目根与配置 / project root + config
  await ctx.plugin(Discovery); // 单元清单服务（list/find�? the unit inventory service (list/find)

  // 命令插件 / command plugins
  await ctx.plugin(ListCommand);
  await ctx.plugin(BuildCommand); // build������Ԫ���͹��� / kind-aware build
  await ctx.plugin(DocCommand);
  await ctx.plugin(TestsCommand); // tests: isolated DSH training grounds
  await ctx.plugin(HelpCommand);

  return ctx;
}
