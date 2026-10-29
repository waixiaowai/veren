/** Images API wire：字节级请求断言、Retry-After 优先重试、结构化错误、模型差异。 */
/** Images API wire: byte-level request assertions, Retry-After-first retries, structured errors, model differences. */
import { describe, expect, it } from 'vitest'
import { ImagegenError } from '../src/errors.js'
import {
  backoffDelay, editImage, generateBody, generateImage, parseRetryAfterSeconds, validateKey,
  type WireClient,
} from '../src/wire.js'
import { recordingFetch } from './support/fakes.js'

const KEY = 'sk-test'

function client(fetch: WireClient['fetch']): WireClient {
  return { baseURL: 'https://images.example/v1', apiKey: KEY, timeoutMs: 5_000, maxAttempts: 3, fetch }
}

function imageResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200 })
}

describe('generateBody', () => {
  it('omits response_format for the gpt-image family', () => {
    const body = generateBody({ model: 'gpt-image-2', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png' })
    expect(body).toMatchObject({ model: 'gpt-image-2', n: 1, output_format: 'png' })
    expect(body).not.toHaveProperty('response_format')
  })

  it('requests b64_json for non-gpt-image models', () => {
    const body = generateBody({ model: 'some-upstream-model', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png' })
    expect(body.response_format).toBe('b64_json')
  })

  it('passes background through only when set', () => {
    const base = { model: 'gpt-image-1.5', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png' as const }
    expect(generateBody(base)).not.toHaveProperty('background')
    expect(generateBody({ ...base, background: 'transparent' }).background).toBe('transparent')
  })
})

describe('generateImage request shape', () => {
  it('sends the endpoint, bearer auth, and the JSON body', async () => {
    const { fetch, calls } = recordingFetch(() => imageResponse())
    await generateImage(client(fetch), {
      model: 'gpt-image-2', prompt: 'a mug', size: '1024x1024', quality: 'low', outputFormat: 'png',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://images.example/v1/images/generations')
    expect(calls[0].init.method).toBe('POST')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ prompt: 'a mug', size: '1024x1024', n: 1 })
  })

  it('decodes the response envelope', async () => {
    const { fetch } = recordingFetch(() => imageResponse())
    const result = await generateImage(client(fetch), {
      model: 'gpt-image-2', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png',
    })
    expect(Buffer.from(result.b64Json, 'base64').toString()).toBe('hello')
  })
})

describe('retry semantics', () => {
  it('retries a 429 honoring Retry-After, then succeeds', async () => {
    const { fetch, calls } = recordingFetch((index) => {
      if (index === 0) {
        return new Response('rate limited', { status: 429, headers: { 'retry-after': '0.05' } })
      }
      return imageResponse()
    })
    const result = await generateImage(client(fetch), {
      model: 'gpt-image-2', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png',
    })
    expect(result.b64Json).toBeDefined()
    expect(calls).toHaveLength(2)
  })

  it('does not retry a non-transient 400 and reports the status', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('bad size', { status: 400 }))
    const promise = generateImage(client(fetch), {
      model: 'gpt-image-2', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png',
    })
    await expect(promise).rejects.toMatchObject({ code: 'IMAGEGEN_API_ERROR', details: { status: 400 } })
    expect(calls).toHaveLength(1)
  })

  it('gives up after maxAttempts on persistent 500s', { timeout: 20_000 }, async () => {
    const { fetch, calls } = recordingFetch(() => new Response('boom', { status: 500 }))
    await expect(generateImage(client(fetch), {
      model: 'gpt-image-2', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png',
    })).rejects.toBeInstanceOf(ImagegenError)
    expect(calls).toHaveLength(3)
  })
})

describe('response validation', () => {
  it('fails structurally when no image data arrives', async () => {
    const { fetch } = recordingFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(generateImage(client(fetch), {
      model: 'gpt-image-2', prompt: 'p', size: 'auto', quality: 'low', outputFormat: 'png',
    })).rejects.toMatchObject({ code: 'IMAGEGEN_INVALID_RESPONSE' })
  })
})

describe('editImage multipart', () => {
  it('attaches input images and scalar fields', async () => {
    const { fetch, calls } = recordingFetch(() => imageResponse())
    const bytes = new Uint8Array([1, 2, 3])
    await editImage(client(fetch), {
      model: 'gpt-image-1.5',
      prompt: 'remove the chair',
      images: [{ bytes, name: 'room.png' }],
      size: '1024x1024',
      inputFidelity: 'high',
    })
    const form = calls[0].init.body as FormData
    expect(calls[0].url).toBe('https://images.example/v1/images/edits')
    expect(form.get('model')).toBe('gpt-image-1.5')
    expect(form.get('prompt')).toBe('remove the chair')
    expect(form.get('input_fidelity')).toBe('high')
    // gpt-image 家族不收 response_format / the gpt-image family takes no response_format
    expect(form.get('response_format')).toBeNull()
    const image = form.get('image')
    expect(image).toBeInstanceOf(File)
    expect((image as File).name).toBe('room.png')
  })
})

describe('validateKey', () => {
  it('answers true on 2xx and false on network failure', async () => {
    const ok = recordingFetch(() => new Response('[]', { status: 200 }))
    await expect(validateKey(client(ok.fetch))).resolves.toBe(true)
    const failing = recordingFetch(() => {
      throw new Error('unreachable')
    })
    await expect(validateKey(client(failing.fetch))).resolves.toBe(false)
  })
})

describe('backoff math', () => {
  it('prefers Retry-After and caps exponential backoff at 60s', () => {
    expect(backoffDelay(1, 7)).toBe(7000)
    expect(backoffDelay(1, undefined)).toBe(2000)
    expect(backoffDelay(10, undefined)).toBe(60_000)
  })

  it('parses fractional and invalid Retry-After headers', () => {
    expect(parseRetryAfterSeconds('0.5')).toBe(0.5)
    expect(parseRetryAfterSeconds('30')).toBe(30)
    expect(parseRetryAfterSeconds('soon')).toBeUndefined()
    expect(parseRetryAfterSeconds(null)).toBeUndefined()
  })
})
