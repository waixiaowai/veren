/**
 * 远端接线审计：客户端声明的 `baiduPan/*` 方法与服务端网关的 @Remote 标记
 * 一一对应；零参方法客户端参数表为空（arity 陷阱的唯一防线）；命名空间与
 * 服务名一致。
 * The Remote wiring audit: the client-declared `baiduPan/*` methods match the
 * gateway's @Remote markers one-for-one; zero-arg methods keep an empty client
 * parameter table (the only defense against the arity trap); namespace and
 * service key agree.
 *
 * @module tests/remote-arity
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { BaiduPanGatewayService } from '../src/gateway.js'
import { resolveConfig } from '../src/config.js'
import { provideWorld } from '../src/service.js'
import { buildWorld } from '../src/world.js'
import { baiduPanRemote } from '../src/client/remote.ts'
import { tokenedCredentials } from './support/fakes.js'

/** 组装一个带真实标记面的网关实例。Assembles one gateway instance with a real marker face. */
function gatewayOf(): BaiduPanGatewayService {
  const ctx = new Context()
  const world = buildWorld(resolveConfig({ appKey: 'k', secretKey: 's' }), tokenedCredentials(), { list: () => [] })
  provideWorld(ctx, world)
  return new BaiduPanGatewayService(ctx)
}

/** 网关上零参的方法名集合（与 src/client/remote.ts 的空参数表一一对应）。The gateway's zero-arg method names (mirrored by empty client parameter tables). */
const ZERO_ARG_METHODS = new Set(['authState', 'beginSignIn', 'signOut', 'whoami', 'quota', 'jobs'])

describe('remote wiring', () => {
  it('declares every @Remote marker and vice versa', () => {
    const gateway = gatewayOf()
    const markerNames = remoteMethods(gateway).map(marker => marker.exportName ?? marker.method).sort()
    const declared = Object.keys(baiduPanRemote.methods)
      .map(key => key.startsWith('baiduPan/') ? key.slice('baiduPan/'.length) : key)
      .sort()
    expect(declared).toEqual(markerNames)
  })

  it('keeps namespace and service key aligned with the client contribution', () => {
    const gateway = gatewayOf()
    expect(gateway.typertRemote.namespace).toBe('baiduPan')
    expect(gateway.typertRemote.serviceKey).toBe('baiduPanGateway')
  })

  it('matches argument arity: zero-arg markers take zero, the rest exactly one', () => {
    const gateway = gatewayOf()
    const members = gateway as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const marker of remoteMethods(gateway)) {
      const arity = members[marker.method]?.length ?? -1
      if (ZERO_ARG_METHODS.has(marker.method)) expect(arity, marker.method).toBe(0)
      else expect(arity, marker.method).toBe(1)
    }
  })
})
