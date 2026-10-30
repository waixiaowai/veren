/**
 * 请求体方言规格：stream 强制、developer 改写、tool_choice 折叠、off 删除、
 * 国际版首条 system 前插。
 * Body-dialect specs: stream forcing, developer rewrite, tool_choice
 * flattening, off dropping, the international leading-system prepend.
 */
import { describe, expect, it } from 'vitest'
import { prepareBodyForRegion, prepareCnChatBody, prepareInternationalChatBody, INTERNATIONAL_SYSTEM_PROMPT } from '../src/chat-body.ts'

describe('公共方言 / common dialect', () => {
  it('stream:true 强制', () => {
    expect(JSON.parse(prepareCnChatBody('{"messages":[]}')).stream).toBe(true)
  })

  it('developer 角色改写为 system（上游 400/11128）', () => {
    const body = JSON.parse(prepareCnChatBody('{"messages":[{"role":"developer","content":"x"},{"role":"user","content":"y"}]}'))
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
  })

  it('tool_choice：none 删字段并连 tools 一起删；auto/required 收字面量；function 收函数名', () => {
    const none = JSON.parse(prepareCnChatBody('{"tools":[{}],"tool_choice":"none"}'))
    expect(none.tool_choice).toBeUndefined()
    expect(none.tools).toBeUndefined()
    const auto = JSON.parse(prepareCnChatBody('{"tool_choice":{"type":"auto"}}'))
    expect(auto.tool_choice).toBe('auto')
    const forced = JSON.parse(prepareCnChatBody('{"tool_choice":{"type":"function","function":{"name":"read_file"}}}'))
    expect(forced.tool_choice).toBe('read_file')
  })

  it('reasoning_effort:"off" 两区域都删（字段缺省是唯一各处实测皆过的形态）', () => {
    expect('reasoning_effort' in JSON.parse(prepareCnChatBody('{"reasoning_effort":"off"}'))).toBe(false)
    expect('reasoning_effort' in JSON.parse(prepareInternationalChatBody('{"reasoning_effort":"off"}'))).toBe(false)
    // 声明档位原样放行。
    expect(JSON.parse(prepareCnChatBody('{"reasoning_effort":"high"}')).reasoning_effort).toBe('high')
  })

  it('非 JSON 体原样返回（不抛）', () => {
    expect(prepareCnChatBody('not json')).toBe('not json')
  })
})

describe('国际版前置条件 / international preconditions', () => {
  it('首条消息非 system 时前插最小 system 提示（前插不合并，既有消息保序）', () => {
    const body = JSON.parse(prepareInternationalChatBody('{"messages":[{"role":"user","content":"hi"}]}'))
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({ role: 'system', content: INTERNATIONAL_SYSTEM_PROMPT })
    expect(body.messages[1].content).toBe('hi')
  })

  it('首条已是 system 时不插', () => {
    const body = JSON.parse(prepareInternationalChatBody('{"messages":[{"role":"system","content":"be brief"},{"role":"user","content":"hi"}]}'))
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].content).toBe('be brief')
  })

  it('CN 体不插 system（CN 没有这条前置条件）', () => {
    const body = JSON.parse(prepareBodyForRegion('cn', '{"messages":[{"role":"user","content":"hi"}]}'))
    expect(body.messages).toHaveLength(1)
  })

  it('按区域分派入口与直调等价', () => {
    const source = '{"messages":[{"role":"user","content":"x"}]}'
    expect(prepareBodyForRegion('global', source)).toBe(prepareInternationalChatBody(source))
    expect(prepareBodyForRegion('cn', source)).toBe(prepareCnChatBody(source))
  })
})
