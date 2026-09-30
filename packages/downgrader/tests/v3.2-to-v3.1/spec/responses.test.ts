import { convertComponent, convertPathItem } from './helpers'

describe('summary and description', () => {
  // 3.2 adds a response `summary` and makes `description` optional:
  // https://spec.openapis.org/oas/v3.2.0.html#response-summary
  // 3.1 requires `description` (https://spec.openapis.org/oas/v3.1.2.html#response-description),
  // so the summary fills it when present, and an empty string otherwise.
  it.each([
    ['uses summary as the description when none exists', { summary: 'ok' }, { description: 'ok' }],
    ['removes summary when a description exists', { description: 'd', summary: 's' }, { description: 'd' }],
    ['adds an empty description when neither exists', {}, { description: '' }],
    ['adds an empty description instead of promoting a malformed summary', { summary: 42 }, { description: '' }],
    ['clones a non-object headers value through', { description: 'ok', headers: 'junk' }, { description: 'ok', headers: 'junk' }],
  ])('%s', (_name, response, expected) => {
    expect(convertComponent('responses', response)).toEqual(expected)
  })

  // Reference Objects already allow `summary` and `description` overrides in
  // 3.1: https://spec.openapis.org/oas/v3.1.2.html#reference-object
  it('leaves response Reference Objects untouched, including their overrides', () => {
    const reference = { $ref: '#/components/responses/R', description: 'override', summary: 'kept' }
    expect(convertComponent('responses', reference)).toEqual(reference)
  })
})

describe('responses maps', () => {
  // Responses Object keys are status codes or `default`; `x-` keys are
  // extensions, not responses: https://spec.openapis.org/oas/v3.2.0.html#responses-object
  it('clones x- keys of the responses map without response conversion', () => {
    expect(convertPathItem({
      get: { responses: { '200': { summary: 'ok' }, 'x-note': { summary: 'not a response' } } },
    })).toEqual({
      get: { responses: { '200': { description: 'ok' }, 'x-note': { summary: 'not a response' } } },
    })
  })

  it('converts response headers, content, and links', () => {
    expect(convertComponent('responses', {
      content: { 'application/json': { itemSchema: { type: 'string' } } },
      description: 'ok',
      headers: { 'X-H': { style: 'cookie' } },
      links: {
        inline: { server: { name: 's', url: '/u' } },
        referenced: { $ref: '#/components/links/L' },
      },
    })).toEqual({
      content: { 'application/json': { schema: { items: { type: 'string' }, type: 'array' } } },
      description: 'ok',
      headers: { 'X-H': {} },
      links: {
        inline: { server: { url: '/u' } },
        referenced: { $ref: '#/components/links/L' },
      },
    })
  })
})
