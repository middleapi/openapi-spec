// There is no direct 3.2 → 3.0 converter on purpose: the two steps compose
// (see the package README). Every official 3.2 document (see corpus.ts) must
// come out of both steps as a valid 3.0 document.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc as queryExample } from '../../types/tests/examples/3-2-query-example'
import { doc as tagsExample } from '../../types/tests/examples/3-2-tags-example'
import { doc as mega } from '../../types/tests/schema-tests-3.2/mega'
import { corpusV32 } from './corpus'
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

// Modelled on the 3.2 spec's `defaultMapping` example: a `petType` of
// `Hamster`, or none at all, selects `OtherPet`, whose `petType` is optional.
// A 3.1 or 3.0 discriminator without the default would select no schema for
// either payload, so both steps must remove it rather than keep the rest.
// https://spec.openapis.org/oas/v3.2.0.html#discriminator-default-mapping
describe('discriminator defaultMapping', () => {
  const pet = (petType: string): OpenAPIV3_2.SchemaObject => ({
    properties: { name: { type: 'string' }, petType: { const: petType } },
    required: ['petType'],
    type: 'object',
  })
  const oneOf = ['Cat', 'Dog', 'Lizard', 'OtherPet'].map(name => ({ $ref: `#/components/schemas/${name}` }))
  const doc: OpenAPIV3_2.OpenAPIObject = {
    components: {
      schemas: {
        Cat: pet('Cat'),
        Dog: pet('Dog'),
        Lizard: pet('Lizard'),
        MyResponseType: { discriminator: { defaultMapping: 'OtherPet', propertyName: 'petType' }, oneOf },
        OtherPet: { properties: { name: { type: 'string' }, petType: { not: { enum: ['Cat', 'Dog', 'Lizard'] } } }, type: 'object' },
      },
    },
    info: { title: 'Pets', version: '1.0.0' },
    openapi: '3.2.0',
    paths: {},
  }

  it('removes the discriminator in both steps and keeps the oneOf', async () => {
    const v31 = await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
    expect(v31.components?.schemas?.MyResponseType).toEqual({ oneOf })
    const v30 = await expectValidDowngrade(doc, downgradeTwice, '3.2', '3.0')
    expect(v30.components?.schemas?.MyResponseType).toEqual({ oneOf })
  })
})
