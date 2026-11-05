/**
 * The hand-built client Remote definitions must match the Host methods' arity:
 * the browser api layer enforces the declared parameter count, so a Host
 * method that takes no argument must be declared with an empty table — the
 * panel's zero-arg `rooms()` call otherwise fails at runtime with
 * "expected 1 argument(s), got 0" and the conversations tab stays empty.
 *
 * 手工构造的客户端 Remote 定义必须匹配宿主方法的入参数：浏览器 api 层按声明的参数个数
 * 校验，宿主零参方法必须声明空参数表——否则面板的零参 `rooms()` 调用会在运行时报
 * "expected 1 argument(s), got 0"，会话页签永远是空的。
 */

import { describe, expect, it } from 'vitest'
import { convRemote, imRemote } from '../src/client/remote.ts'

/** Endpoint -> declared parameter count, per namespace. */
const CONV_ARITY: Readonly<Record<string, number>> = {
  rooms: 0,
  roomMembers: 1,
  messages: 1,
  markRead: 1,
}

const IM_ARITY: Readonly<Record<string, number>> = {
  catalog: 1,
  beginBind: 1,
  pollBind: 1,
  submitBindCode: 1,
  unbindAccount: 1,
  people: 1,
  renamePerson: 1,
  intakeStatus: 1,
}

describe('client remote arity', () => {
  it('declares imConv parameters exactly as the conversation Host methods take them', () => {
    const declared = Object.fromEntries(convRemote.descriptors.map(it => [it.method, it.parameters.length]))
    expect(declared).toEqual(CONV_ARITY)
  })

  it('declares one request parameter for every im endpoint', () => {
    const declared = Object.fromEntries(imRemote.descriptors.map(it => [it.method, it.parameters.length]))
    expect(declared).toEqual(IM_ARITY)
  })
})
