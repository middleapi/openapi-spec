# Real-document fixtures

Official OpenAPI documents embedded as TypeScript object literals. Each file types its document as the `OpenAPIObject` of the version module matching its `openapi` field, so `pnpm type:check` at the repository root compiles the whole corpus and fails whenever the types reject a valid document. The downgrader's corpus tests reuse the same fixtures as conversion input.

Sources (Apache-2.0, © the OpenAPI Initiative):

- `examples/`: the official example documents from [OAI/learn.openapis.org](https://github.com/OAI/learn.openapis.org/tree/main/examples), 3.0, 3.1, and 3.2 sets
- `schema-tests-3.1/`: the `tests/schema/pass` documents from the [OAI/OpenAPI-Specification `v3.1-dev` branch](https://github.com/OAI/OpenAPI-Specification/tree/v3.1-dev/tests/schema/pass)
- `schema-tests-3.2/`: the `tests/schema/pass` documents from the [OAI/OpenAPI-Specification `v3.2-dev` branch](https://github.com/OAI/OpenAPI-Specification/tree/v3.2-dev/tests/schema/pass)

The matching `tests/schema/fail` documents are not committed. Most of them break semantic rules the types document rather than encode: mutual exclusions, at-least-one-of containers, per-location field applicability, non-empty arrays, and map-key syntax. The ones the types can catch (unknown top-level fields, wrong value shapes, excess fields on Header and Link Objects, 3.2-only `style` values in 3.1 documents) were verified to fail compilation when the corpus was generated.

The files are generated. Refresh them from the sources above instead of editing by hand.
