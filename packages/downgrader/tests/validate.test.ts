import { expectNoNewDanglingRefs } from './validate'

// The oracle checks only references that resolved in the input, so a
// reference that wrongly resolved there would be held to the output too.
describe('expectNoNewDanglingRefs', () => {
  it('fails when a reference that resolved in the input no longer does', () => {
    expect(() => expectNoNewDanglingRefs({ a: [1] }, { r: { $ref: '#/a/0' } })).toThrow()
  })

  // https://www.rfc-editor.org/rfc/rfc6901#section-4
  it.each([
    ['an array property that is not an index', '#/a/length'],
    ['an index with a leading zero', '#/a/00'],
    ['a plain-name fragment, which names an anchor', '#pet'],
  ])('does not resolve %s', (_name, ref) => {
    expect(() => expectNoNewDanglingRefs({ a: [1], et: 1 }, { r: { $ref: ref } })).not.toThrow()
  })
})
