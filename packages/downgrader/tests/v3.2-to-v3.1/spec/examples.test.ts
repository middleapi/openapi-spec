import { convertComponent } from './helpers'

// 3.2 splits an example value into `dataValue` (the data, as the schema sees
// it) and `serializedValue` (the bytes on the wire):
// https://spec.openapis.org/oas/v3.2.0.html#example-data-value
// https://spec.openapis.org/oas/v3.2.0.html#example-serialized-value
// 3.1 has only `value` and `externalValue`, which are mutually exclusive:
// https://spec.openapis.org/oas/v3.1.2.html#example-value
// The data form wins the free `value` slot because it is what 3.1 `value`
// holds for JSON-like media types. When `value` or `externalValue` is
// already set, the new fields are simply removed.
describe('dataValue and serializedValue', () => {
  it.each([
    ['moves dataValue into the free value slot', { dataValue: { a: 1 } }, { value: { a: 1 } }],
    ['moves serializedValue into the free value slot', { serializedValue: 'a=1' }, { value: 'a=1' }],
    ['lets dataValue win the value slot over serializedValue', { dataValue: 1, serializedValue: 's' }, { value: 1 }],
    ['removes dataValue when value already exists', { dataValue: 1, value: 2 }, { value: 2 }],
    ['removes serializedValue when value already exists', { serializedValue: 's', value: 2 }, { value: 2 }],
    [
      'removes both when externalValue exists',
      { dataValue: 1, externalValue: 'https://example.com/e.json', serializedValue: 's' },
      { externalValue: 'https://example.com/e.json' },
    ],
    ['keeps the other example fields', { dataValue: 1, description: 'd', summary: 's' }, { description: 'd', summary: 's', value: 1 }],
    ['leaves an example without value fields unchanged', { summary: 's' }, { summary: 's' }],
    ['clones a malformed example through', 42, 42],
  ])('%s', (_name, example, expected) => {
    expect(convertComponent('examples', example)).toEqual(expected)
  })
})
