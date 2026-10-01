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

describe('shared copies', () => {
  // 3.2 → 3.1 inlines `Form` once and shares the copy between the request
  // body and the webhook header. In 3.1 → 3.0 the header, inlined from the
  // removed webhook, leads back to that shared copy while it is still being
  // converted.
  it('cuts only the inner reference of a media type that 3.2 → 3.1 shares with a header leading back to it', async () => {
    const form = { $ref: '#/components/mediaTypes/Form' }
    const doc: OpenAPIV3_2.OpenAPIObject = {
      components: {
        mediaTypes: {
          Form: {
            encoding: { a: { headers: { 'X-Trace': { $ref: '#/webhooks/done/post/responses/200/headers/X-Trace' } } } },
            schema: { type: 'object' },
          },
        },
      },
      info: { title: 't', version: '1' },
      openapi: '3.2.0',
      paths: { '/a': { post: { requestBody: { content: { 'multipart/form-data': form } }, responses: { 200: { description: 'ok' } } } } },
      webhooks: {
        done: {
          post: { responses: { 200: { description: 'ok', headers: { 'X-Trace': { content: { 'multipart/form-data': form } } } } } },
        },
      },
    }
    const v30 = await expectValidDowngrade(doc, downgradeTwice, '3.2', '3.0')
    expect(dig(v30, 'paths', '/a', 'post', 'requestBody', 'content', 'multipart/form-data', 'encoding', 'a', 'headers')).toEqual({
      'X-Trace': { content: { 'multipart/form-data': { encoding: { a: { headers: {} } }, schema: { type: 'object' } } } },
    })
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
