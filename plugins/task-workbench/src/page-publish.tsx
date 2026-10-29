/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 发布页（工具页 action 档）：无参入口 + publish_task 写工具。target_app 来自
 * 注册表目录（缺省 = 本应用详情页）；发布即进任务中心队列。
 * The publish page (the action archetype): a parameterless entry + the
 * publish_task write tool. target_app comes from the registry catalog (default
 * = this app's detail page); publishing lands the order in the center queue.
 * @module @veren/task-workbench
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { requireRuntime, toolOf, URL_PREFIX } from './pages.tsx'

/** 发布页组件体（一次性渲染）/ the publish page's body (the one-shot render) */
export const PublishPage: PageFC<{ draftTitle?: string }> = (props, agent) => {
  agent.ctx.tools.register(toolOf('publish_task'))
  const { catalog } = requireRuntime()
  const apps = catalog().filter((record) => record.state === 'active' && record.definition.id !== 'task-workbench')
  return (
    <>
      <h1>任务工作台 · 发布工作单</h1>
      <p>草稿标题：{props.draftTitle ?? ''}。用 publish_task 确认发布；标题为空时不要调用。</p>
      <p>不给 target_app 时落在本应用队列；要派给别的应用时，target_app 从下面的目录里选（落点是它的 entry 页）：</p>
      <ul>
        {apps.map((record) => (
          <li key={record.definition.id}>{record.definition.id} → {record.definition.description}</li>
        ))}
      </ul>
      <blockquote>发布不支持带子任务的模板——子任务由接取者在其任务详情页现场拆分。</blockquote>
    </>
  )
}

export const PublishMeta: ComponentPageMeta<{ draftTitle?: string }> = {
  name: 'publish',
  url: `${URL_PREFIX}/publish`,
  description: '发布工作单页：填写草稿并确认发布（投递到宿主任务中心，可选目标应用）',
  writes: true,
  instructions: '这是任务发布页：草稿标题见正文。用 publish_task 确认发布；标题为空时不要调用。'
    + 'target_app 缺省 = 本应用详情页；要派给别的应用时从正文目录里选 id（落点是该应用的 entry 页；'
    + '带 :param 的页会被 dispatch/target-invalid 拒绝）。'
    + '发布是写动作：需要本回合同意（用户消息），browse 先 drive_begin。'
    + '发布不支持带子任务的模板（§4.7.6），子任务由接取者在其任务详情页现场拆分。',
}
