/**
 * tests 命令分发测试：子命令的 JSON 输出、纯路径输出与错误码。
 *
 * tests command dispatch tests: JSON output of the subcommands, bare-path
 * output and error codes.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrainingGround } from '../src/ground';
import { createTestsCommand } from '../src/commands';
import { createDeps, createOptions, makeWorkspace, removeWorkspace, type WorkspaceFixtures } from './helpers';

let fx: WorkspaceFixtures;

beforeEach(() => {
  fx = makeWorkspace();
});

afterEach(() => {
  removeWorkspace(fx);
});

describe('命令分发 / command dispatch', () => {
  it('list 输出 JSON，path 输出纯路径，create 支持 dry-run / list prints JSON, path prints a bare path, create supports dry-run', async () => {
    await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));
    const output: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      await runListAndAssert(createTestsCommandForFixtures(), output);
      await runPathAndAssert(createTestsCommandForFixtures(), output);
      await runCreateDryRunAndAssert(createTestsCommandForFixtures(), output);
    } finally {
      spy.mockRestore();
    }
  });

  it('未知子命令与多余参数报错 / unknown subcommands and extra arguments fail', async () => {
    const command = createTestsCommandForFixtures();
    await expect(command.run(['nope'])).rejects.toMatchObject({ code: 'TESTS_UNKNOWN_SUBCOMMAND' });
    await expect(command.run(['list', 'extra'])).rejects.toMatchObject({ code: 'TESTS_INVALID_ARGUMENTS' });
    await expect(command.run(['list', '--wat'])).rejects.toMatchObject({ code: 'TESTS_INVALID_OPTION' });
  });
});

/** 以当前夹具装配 tests 命令 / assemble the tests command from the current fixtures */
function createTestsCommandForFixtures(): ReturnType<typeof createTestsCommand> {
  return createTestsCommand({
    root: fx.root,
    sourceHome: fx.sourceHome,
    harnessRoot: fx.harnessRoot,
    profile: 'web',
    initProfile: fx.fake.init,
    start: async () => {},
  });
}

/** list 输出 JSON 且只含托管训练场 / list prints JSON holding only managed grounds */
async function runListAndAssert(
  command: ReturnType<typeof createTestsCommand>,
  output: string[],
): Promise<void> {
  await command.run(['list']);
  const listed = JSON.parse(output.join('')) as Array<{ name: string; managed: boolean }>;
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ name: 'alpha', managed: true });
  output.length = 0;
}

/** path 输出纯路径 / path prints the bare path */
async function runPathAndAssert(
  command: ReturnType<typeof createTestsCommand>,
  output: string[],
): Promise<void> {
  await command.run(['path', 'alpha']);
  expect(output.join('')).toBe(`${join(fx.root, 'alpha')}\n`);
  output.length = 0;
}

/** create --dry-run 只报探测结论，不落盘 / create --dry-run reports findings only, nothing on disk */
async function runCreateDryRunAndAssert(
  command: ReturnType<typeof createTestsCommand>,
  output: string[],
): Promise<void> {
  await command.run(['create', 'beta', '--dry-run']);
  const created = JSON.parse(output.join('')) as { dryRun: boolean; sourceProfile: string };
  expect(created).toMatchObject({ dryRun: true, sourceProfile: 'desktop' });
  expect(existsSync(join(fx.root, 'beta'))).toBe(false);
}
