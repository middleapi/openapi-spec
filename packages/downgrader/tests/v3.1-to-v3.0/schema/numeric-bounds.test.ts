// JSON Schema 2020-12 `exclusiveMinimum` / `exclusiveMaximum` are numbers,
// bounds of their own:
// https://json-schema.org/draft/2020-12/json-schema-validation#section-6.2.5
// In 3.0 (draft Wright-00) they are booleans that make `minimum` / `maximum`
// exclusive: https://spec.openapis.org/oas/v3.0.4.html#json-schema-keywords
// https://learn.openapis.org/upgrading/v3.0-to-v3.1.html#update-exclusiveminimum-and-exclusivemaximum
// 3.1 allows both an inclusive and an exclusive bound at once, while 3.0 has
// one bound per side, so the tighter of the two is kept. At a tie the
// exclusive one is tighter.

import { convertSchema } from './helpers'

it.each([
  ['turns a numeric exclusiveMinimum into minimum plus the flag', { exclusiveMinimum: 3 }, { exclusiveMinimum: true, minimum: 3 }],
  ['keeps a tighter inclusive minimum', { exclusiveMinimum: 3, minimum: 5 }, { minimum: 5 }],
  ['replaces a looser inclusive minimum', { exclusiveMinimum: 5, minimum: 3 }, { exclusiveMinimum: true, minimum: 5 }],
  ['prefers the exclusive form for equal minimums', { exclusiveMinimum: 3, minimum: 3 }, { exclusiveMinimum: true, minimum: 3 }],
  ['turns a numeric exclusiveMaximum into maximum plus the flag', { exclusiveMaximum: 10 }, { exclusiveMaximum: true, maximum: 10 }],
  ['keeps a tighter inclusive maximum', { exclusiveMaximum: 10, maximum: 5 }, { maximum: 5 }],
  ['replaces a looser inclusive maximum', { exclusiveMaximum: 5, maximum: 10 }, { exclusiveMaximum: true, maximum: 5 }],
  ['prefers the exclusive form for equal maximums', { exclusiveMaximum: 5, maximum: 5 }, { exclusiveMaximum: true, maximum: 5 }],
  ['converts both sides at once', { exclusiveMaximum: 9, exclusiveMinimum: 1 }, { exclusiveMaximum: true, exclusiveMinimum: true, maximum: 9, minimum: 1 }],
])('%s', (_name, input, expected) => {
  expect(convertSchema(input)).toEqual(expected)
})

it.each([
  ['a 3.0-style boolean exclusiveMinimum', { exclusiveMinimum: true, minimum: 3 }],
  ['a 3.0-style boolean exclusiveMaximum', { exclusiveMaximum: false, maximum: 3 }],
])('passes %s through', (_name, input) => {
  expect(convertSchema(input)).toEqual(input)
})
