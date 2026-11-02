/** Default deployment and machine fixtures for tests. */
import type { Volatile } from '@deepseek-ai/cordis'
import type { Deployment, Machine } from '../../src/deployment.ts'

/** Mutable Volatile reference for simulating live configuration updates. */
export const reference = <T>(value: T): Volatile<T> & { set(next: T): void } => {
  let current = value
  return { get: () => current as never, set: next => { current = next } }
}
export const testMachine = (overrides: Partial<Machine> = {}): Machine => ({
  stateDir: '/tmp/dsh-superagent-test', promptMaxChars: reference(100000), admissionContextMaxPages: reference(10),
  admissionContextTimeoutMs: reference(15000), ...overrides,
})
export const testDeployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  ...testMachine(), repository: 'acme/widgets',
  github: { cli: '/bin/false', login: 'agent-bot', noreply: '7+agent-bot@users.noreply.github.com' },
  feishu: { cli: '/bin/false', botId: 'ou_bot', appId: 'cli_bot', brand: 'feishu', name: 'Widgets Bot' },
  ...overrides,
})
/** The default deployment plus a Gitea account, for Gitea Source and environment tests. */
/** 默认部署再加一个 Gitea 账号，供 Gitea 来源与环境测试使用。 */
export const testGiteaDeployment = (overrides: Partial<Deployment> = {}): Deployment =>
  testDeployment({ gitea: { host: 'https://gitea.acme.test', repository: 'acme/widgets', cli: '/bin/false', login: 'agent-bot',
    noreply: '7+agent-bot@noreply.gitea.acme.test' }, ...overrides })
