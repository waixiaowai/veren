/** guard 验收：GD-01~GD-07 的路径裁决、确认凭证与脱敏规则。 */
/** guard acceptance: the GD-01..GD-07 path verdicts, confirmation vouchers, and redaction rules. */
import { describe, expect, it } from 'vitest'
import { checkAction, checkPath, redact } from '../src/guard.js'

const ROOT = '/apps/bdpan'

describe('checkPath verdicts', () => {
  it('GD-01: refuses standalone parent-directory segments', () => {
    const verdict = checkPath('/apps/bdpan/a/../b.txt', ROOT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('traversal')
  })

  it('GD-02: refuses encoded traversal', () => {
    const verdict = checkPath('%2e%2e/%2e%2e/etc/passwd', ROOT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('encoded-traversal')
  })

  it('GD-03: refuses paths outside the root', () => {
    const verdict = checkPath('/apps/other/file.txt', ROOT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('outside-root')
  })

  it('GD-04: keeps legitimate consecutive dots inside names', () => {
    const verdict = checkPath('a..b/会议..txt', ROOT)
    expect(verdict.allowed).toBe(true)
    expect(verdict.normalized).toBe(`${ROOT}/a..b/会议..txt`)
  })

  it('GD-05: refuses separators in single names', () => {
    const verdict = checkPath('x/y', ROOT, { singleName: true })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('invalid-name')
  })

  it('resolves relative inputs against the root', () => {
    const verdict = checkPath('docs/a.pdf', ROOT)
    expect(verdict.allowed).toBe(true)
    expect(verdict.normalized).toBe(`${ROOT}/docs/a.pdf`)
  })

  it('allows the root itself', () => {
    const verdict = checkPath(ROOT, ROOT)
    expect(verdict.allowed).toBe(true)
    expect(verdict.normalized).toBe(ROOT)
  })

  it('refuses tilde expansion and platform traps', () => {
    expect(checkPath('~/x', ROOT).reason).toBe('tilde')
    expect(checkPath('a\\b', ROOT).reason).toBe('platform-trap')
    expect(checkPath('a:b', ROOT).reason).toBe('platform-trap')
  })

  it('refuses empty inputs', () => {
    expect(checkPath('', ROOT).reason).toBe('empty')
    expect(checkPath('  ', ROOT).reason).toBe('empty')
  })

  it('maps the /apps prefix to the display form', () => {
    const verdict = checkPath(`${ROOT}/docs/a.pdf`, ROOT)
    expect(verdict.displayPath).toBe('我的应用数据/bdpan/docs/a.pdf')
  })
})

describe('checkAction vouchers', () => {
  it('GD-06: allows when the voucher covers exactly the targets', () => {
    const verdict = checkAction(ROOT, [`${ROOT}/a.txt`, `${ROOT}/b.txt`], { paths: [`${ROOT}/b.txt`, `${ROOT}/a.txt`] })
    expect(verdict).toEqual({ decision: 'allow' })
  })

  it('GD-07: demands confirmation when the voucher misses a target', () => {
    const verdict = checkAction(ROOT, [`${ROOT}/a.txt`, `${ROOT}/b.txt`], { paths: [`${ROOT}/a.txt`] })
    expect(verdict).toEqual({ decision: 'confirm', code: 'BDPAN_CONFIRM_REQUIRED' })
  })

  it('demands confirmation when the voucher carries extras', () => {
    const verdict = checkAction(ROOT, [`${ROOT}/a.txt`], { paths: [`${ROOT}/a.txt`, `${ROOT}/b.txt`] })
    expect(verdict).toEqual({ decision: 'confirm', code: 'BDPAN_CONFIRM_REQUIRED' })
  })

  it('demands confirmation without a voucher', () => {
    const verdict = checkAction(ROOT, [`${ROOT}/a.txt`], undefined)
    expect(verdict).toEqual({ decision: 'confirm', code: 'BDPAN_CONFIRM_REQUIRED' })
  })

  it('denies out-of-root targets before any confirmation logic', () => {
    const verdict = checkAction(ROOT, ['/apps/other/a.txt'], { paths: ['/apps/other/a.txt'] })
    expect(verdict).toEqual({ decision: 'deny', reason: 'outside-root' })
  })

  it('denies empty target sets', () => {
    const verdict = checkAction(ROOT, [], { paths: [] })
    expect(verdict).toEqual({ decision: 'deny', reason: 'empty' })
  })
})

describe('redact', () => {
  it('masks sensitive string values and leaves the rest intact', () => {
    const input = {
      accessToken: 'access-token-value',
      nested: { refresh_token: 'refresh-value', plain: 'plain-value' },
      list: [{ secretKey: 'secret-value' }],
      count: 3,
    }
    const output = redact(input) as typeof input
    expect(output.accessToken).toBe('ac***ue')
    expect(output.nested.refresh_token).toBe('re***ue')
    expect(output.nested.plain).toBe('plain-value')
    expect(output.list[0]?.secretKey).toBe('se***ue')
    expect(output.count).toBe(3)
    // 原对象不被修改。
    // The input object is never mutated.
    expect(input.accessToken).toBe('access-token-value')
  })
})
