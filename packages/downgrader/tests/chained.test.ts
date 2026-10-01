// There is no direct 3.2 → 3.0 converter on purpose: the two steps compose
// (see the package README). Every official 3.2 document (see corpus.ts) must
// come out of both steps as a valid 3.0 document.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc as queryExample } from '../../types/tests/examples/3-2-query-example'
import { doc as tagsExample } from '../../types/tests/examples/3-2-tags-example'
import { doc as mega } from '../../types/tests/schema-tests-3.2/mega'
import { corpusV32 } from './corpus'
import { dig } from './helpers'
import { expectValidDowngrade } from './validate'

function downgradeTwice(doc: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(doc))
}

// The 3.2 → 3.1 step is validated by v3.2-to-v3.1/spec/corpus.test.ts.
describe('official corpus', () => {
  it.each(corpusV32)('converts %s to a valid 3.0 document', async (_name, doc) => {
    await expectValidDowngrade(doc, downgradeTwice, '3.2', '3.0')
  })
})

// A 3.2 XML Object without `nodeType` is a `none` node beside `$ref`, which
// ignores `name`, and an explicit `element` on an array wraps it even when
// the array type comes through `$ref`. 3.1 and 3.0 have no `nodeType`, so the
// name must go and `wrapped: true` needs the array `type` beside it.
it('keeps 3.2 XML node types through both steps', async () => {
  const doc: OpenAPIV3_2.OpenAPIObject = {
    components: {
      schemas: {
        Book: { type: 'object' },
        Books: { items: { $ref: '#/components/schemas/Book' }, type: 'array' },
        Person: { type: 'object' },
        Shelf: {
          properties: {
            author: { $ref: '#/components/schemas/Person', xml: { name: 'writer' } },
            books: { $ref: '#/components/schemas/Books', xml: { name: 'shelf', nodeType: 'element' } },
          },
          type: 'object',
        },
      },
    },
    info: { title: 'Library', version: '1.0.0' },
    openapi: '3.2.0',
  }
  const v31 = await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
  expect(dig(v31, 'components', 'schemas', 'Shelf', 'properties')).toEqual({
    author: { $ref: '#/components/schemas/Person', xml: {} },
    books: { $ref: '#/components/schemas/Books', type: 'array', xml: { name: 'shelf', wrapped: true } },
  })
  const v30 = await expectValidDowngrade(doc, downgradeTwice, '3.2', '3.0')
  expect(dig(v30, 'components', 'schemas', 'Shelf', 'properties')).toEqual({
    author: { allOf: [{ $ref: '#/components/schemas/Person' }], xml: {} },
    books: { allOf: [{ $ref: '#/components/schemas/Books' }], items: {}, type: 'array', xml: { name: 'shelf', wrapped: true } },
  })
})

describe('official examples', () => {
  it('converts the query example', () => {
    expect(downgradeTwice(queryExample)).toMatchSnapshot()
  })

  it('converts the tags example', () => {
    expect(downgradeTwice(tagsExample)).toMatchSnapshot()
  })

  it('converts the mega document', () => {
    const v30 = downgradeTwice(mega)
    expect(v30.components).not.toHaveProperty('pathItems')
    expect(v30).not.toHaveProperty('webhooks')
    expect(v30).toMatchSnapshot()
  })
})
