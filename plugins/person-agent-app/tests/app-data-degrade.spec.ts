/**
 * 真实数据与读取失败降级：taskCenter 读取失败时任务区如实标注原因、同步两区
 * 照常给真实数据；workspaceRegistry 在场给真实行、为空给空列表——失败显式
 * 降级，不抛异常、不编造。
 * Real data and read-failure degrade: a failing taskCenter labels the tasks
 * section honestly while both sync sections stay real; a present
 * workspaceRegistry yields real rows and an empty one an empty list - failures
 * degrade explicitly, with no throw and no faking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindPersonAgentContext, OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from '../src/pages.tsx'
import { disposeTracked, install, mountPage, trackDisposer } from './app-harness.ts'

afterEach(disposeTracked)

describe('真实数据与读取失败降级', () => {
  it('taskCenter 读取失败：任务区如实标注原因，同步两区照常给真实数据', async () => {
    const { ctx, fiber } = await install({ failList: true, workspaces: undefined })
    trackDisposer(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const page = await mountPage(OverviewPage, OverviewMeta, ctx)
    await vi.waitFor(() => expect(page.followups().length).toBeGreaterThan(0))
    // 同步区首帧照常真实；失败显式降级进首屏消息（不抛异常、不编造）
    // / sync sections stay real on frame 1; the failure degrades explicitly into the first-screen message (no throw, no faking)
    expect(page.body).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(page.followups().join('\n')).toContain('待办任务读取失败：storage backend down')
  })

  it('workspaceRegistry 在场：workspaces 页给出真实行；注册表为空时给出空列表', async () => {
    const withWorkspaces = await install()
    trackDisposer(() => withWorkspaces.fiber.dispose())
    bindPersonAgentContext(withWorkspaces.ctx)
    const withMount = await mountPage(WorkspacesPage, WorkspacesMeta, withWorkspaces.ctx)
    expect(withMount.body).toContain('主工作区（id: ws-1；会话账目 2）')
    const empty = await install({ workspaces: [] })
    trackDisposer(() => empty.fiber.dispose())
    bindPersonAgentContext(empty.ctx)
    const emptyMount = await mountPage(WorkspacesPage, WorkspacesMeta, empty.ctx)
    expect(emptyMount.body).toContain('共 0 个工作区')
  })
})
