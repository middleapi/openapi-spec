import { dig } from '../../helpers'
import { convertComponent, convertSpec } from './helpers'

it('removes pathItems and keeps the other component maps', () => {
  const result = convertSpec({
    components: {
      pathItems: { Reusable: { get: { summary: 's' } } },
      schemas: { S: { type: 'string' } },
    },
  })
  expect(result.components).toEqual({ schemas: { S: { type: 'string' } } })
  expect(result.components).not.toHaveProperty('x-pathItems')
})

it('converts component callbacks and schemas, including boolean schemas', () => {
  expect(convertSpec({
    components: {
      'callbacks': {
        junkCallback: 42,
        realCallback: {
          'x-note': { '{$expr}': { get: {} } },
          '{$request.body#/url}': { post: { summary: 's' } },
        },
      },
      'schemas': { S: { type: ['string', 'null'] }, T: true },
      'x-extra': { keep: true },
    },
  }).components).toEqual({
    'callbacks': {
      junkCallback: 42,
      realCallback: {
        'x-note': { '{$expr}': { get: {} } },
        '{$request.body#/url}': { post: { responses: { default: { description: '' } }, summary: 's' } },
      },
    },
    'schemas': { S: { nullable: true, type: 'string' }, T: {} },
    'x-extra': { keep: true },
  })
})

it('strips the overrides from a callback reference to a missing path item', () => {
  expect(convertComponent('callbacks', { $ref: '#/components/pathItems/Reusable', summary: 's' })).toEqual({
    $ref: '#/components/pathItems/Reusable',
  })
})

it('keeps examples as they are, since 3.0 examples have the same fields', () => {
  expect(convertComponent('examples', { description: 'd', summary: 's', value: { a: 1 } })).toEqual({
    description: 'd',
    summary: 's',
    value: { a: 1 },
  })
})

it('clones a malformed components value unchanged', () => {
  expect(convertSpec({ components: 'junk' }).components).toBe('junk')
})

// A single object can sit in positions of different kinds, for example as
// both an Operation and a Schema. Each position gets its own conversion,
// whichever it meets first.
it('converts an object shared between an operation and a schema as each', () => {
  const shared = {}
  for (const fields of [
    { components: { schemas: { S: shared } }, paths: { '/a': { get: shared } } },
    { paths: { '/a': { get: shared } }, components: { schemas: { S: shared } } },
  ]) {
    const result = convertSpec(fields)
    expect(dig(result, 'paths', '/a', 'get')).toEqual({ responses: { default: { description: '' } } })
    expect(dig(result, 'components', 'schemas', 'S')).toEqual({})
  }
})
