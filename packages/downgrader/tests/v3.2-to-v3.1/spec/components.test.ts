import { dig } from '../../helpers'
import { convertComponent, convertSpec } from './helpers'

describe('component maps', () => {
  it('converts inline objects and keeps references to surviving ones in every map', () => {
    expect(convertSpec({
      components: {
        examples: { E: { dataValue: 1 }, ERef: { $ref: '#/components/examples/E' } },
        headers: { H: { style: 'cookie' }, HRef: { $ref: '#/components/headers/H' } },
        links: { junkLink: 42 },
        parameters: { P: { in: 'querystring', name: 'q' }, PRef: { $ref: '#/components/parameters/P' } },
        requestBodies: {
          B: { content: { 'application/json': { itemSchema: { type: 'string' } } } },
          BRef: { $ref: '#/components/requestBodies/B' },
        },
        responses: { R: { summary: 'ok' }, RRef: { $ref: '#/components/responses/R' } },
      },
    }).components).toEqual({
      examples: { E: { value: 1 }, ERef: { $ref: '#/components/examples/E' } },
      headers: { H: {}, HRef: { $ref: '#/components/headers/H' } },
      links: { junkLink: 42 },
      parameters: {},
      requestBodies: {
        B: { content: { 'application/json': { schema: { items: { type: 'string' }, type: 'array' } } } },
        BRef: { $ref: '#/components/requestBodies/B' },
      },
      responses: { R: { description: 'ok' }, RRef: { $ref: '#/components/responses/R' } },
    })
  })

  it('converts components.schemas entries', () => {
    expect(convertComponent('schemas', {
      discriminator: { defaultMapping: 'Dog', propertyName: 'kind' },
      xml: { nodeType: 'attribute' },
    })).toEqual({
      discriminator: { propertyName: 'kind' },
      xml: { attribute: true },
    })
  })

  it('wraps a components.schemas entry that references an array', () => {
    expect(dig(convertSpec({
      components: {
        schemas: {
          List: { type: 'array' },
          Wrapped: { $ref: '#/components/schemas/List', xml: { name: 'w', nodeType: 'element' } },
        },
      },
    }), 'components', 'schemas', 'Wrapped')).toEqual({ $ref: '#/components/schemas/List', xml: { name: 'w', wrapped: true } })
  })

  it('clones unknown component keys and passes a non-object components value through', () => {
    expect(convertSpec({ components: { custom: { anything: true } } }).components).toEqual({ custom: { anything: true } })
    expect(convertSpec({ components: 'junk' }).components).toBe('junk')
  })
})
