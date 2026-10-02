<h1 align="center">OpenAPI Spec</h1>

<div align="center">
  <a href="https://codecov.io/gh/middleapi/openapi-spec">
    <img alt="codecov" src="https://codecov.io/gh/middleapi/openapi-spec/branch/main/graph/badge.svg">
  </a>
  <a href="https://www.npmjs.com/package/@openapi-spec/downgrader">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dw/%40openapi-spec%2Fdowngrader?logo=npm" />
  </a>
  <a href="https://github.com/middleapi/openapi-spec/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/middleapi/openapi-spec?logo=open-source-initiative" />
  </a>
  <a href="https://discord.gg/TXEbwRBvQn">
    <img alt="Discord" src="https://img.shields.io/discord/1308966753044398161?color=7389D8&label&logo=discord&logoColor=ffffff" />
  </a>
  <a href="https://deepwiki.com/middleapi/openapi-spec">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki">
  </a>
</div>

`@openapi-spec/downgrader` downgrades [OpenAPI Specification](https://spec.openapis.org/) documents and Schema Objects one minor version at a time, 3.2 to 3.1 and 3.1 to 3.0, for tools that only support an older version, such as code generators, gateways, and validators.

Downgrading loses detail, never meaning. Anything the older version lacks becomes an equivalent or, failing that, is removed, so a downgraded schema accepts every value the original accepts, and possibly more. Each downgrader below lists what it removes and its limitations.

## Usage

```ts
import {
  downgradeSchemaV31ToV30,
  downgradeSchemaV32ToV31,
  downgradeSpecV31ToV30,
  downgradeSpecV32ToV31,
} from '@openapi-spec/downgrader'

const v31 = downgradeSpecV32ToV31(v32Document)
const v30 = downgradeSpecV31ToV30(v31Document)

// There is no direct 3.2 to 3.0 converter on purpose. Compose the steps:
const downgraded = downgradeSpecV31ToV30(downgradeSpecV32ToV31(v32Document))

// Schema Objects convert on their own:
downgradeSchemaV31ToV30({ type: ['string', 'null'] })
// { type: 'string', nullable: true }
```

| Function                  | Input               | Output                                  |
| ------------------------- | ------------------- | --------------------------------------- |
| `downgradeSpecV32ToV31`   | 3.2 `OpenAPIObject` | 3.1 `OpenAPIObject`                     |
| `downgradeSchemaV32ToV31` | 3.2 `SchemaObject`  | 3.1 `SchemaObject`                      |
| `downgradeSpecV31ToV30`   | 3.1 `OpenAPIObject` | 3.0 `OpenAPIObject`                     |
| `downgradeSchemaV31ToV30` | 3.1 `SchemaObject`  | 3.0 `SchemaObject` or `ReferenceObject` |

Each step can also be imported on its own from `@openapi-spec/downgrader/v3.2-to-v3.1` or `@openapi-spec/downgrader/v3.1-to-v3.0`. All types come from [`@openapi-spec/types`](https://github.com/middleapi/openapi-spec/blob/main/packages/types/README.md).

## 3.2 → 3.1

### Spec (`downgradeSpecV32ToV31`)

Schema Objects inside the document convert as in [Schema](#schema-downgradeschemav32tov31).

#### Removed

| API                                                                                                                                                     | Why                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`$self`][3.2-self]                                                                                                                                     | Sets the document's own URI and base URI. 3.1 has no such field and resolves against the retrieval URL.                                                                                                                                  |
| [`components.mediaTypes`][3.2-components-media-types]                                                                                                   | 3.1 has no reusable Media Type Objects. `$ref`s to them are inlined.                                                                                                                                                                     |
| Server [`name`][3.2-server-name]                                                                                                                        | A unique name for the server. A 3.1 Server has only `url`, `description`, and `variables`.                                                                                                                                               |
| Tag [`summary`][3.2-tag-summary], [`parent`][3.2-tag-parent], and [`kind`][3.2-tag-kind]                                                                | Display title, nesting, and category. A 3.1 Tag has only `name`, `description`, and `externalDocs`.                                                                                                                                      |
| Path Item [`query`][3.2-path-item-query]                                                                                                                | The HTTP QUERY method. A 3.1 Path Item allows only eight fixed methods, and `post` would wrongly claim an unsafe, non-idempotent request.                                                                                                |
| Path Item [`additionalOperations`][3.2-path-item-additional-operations]                                                                                 | Other HTTP methods, such as `PURGE`, which 3.1 cannot describe either.                                                                                                                                                                   |
| [`in: "querystring"`][3.2-parameter-locations] parameters and `$ref`s to them                                                                           | Describes the whole query string as one media-typed value. A 3.1 `in: query` parameter describes one named key.                                                                                                                          |
| [`allowReserved`][3.2-parameter-allow-reserved] outside `in: query`                                                                                     | 3.1 applies it only to query parameters, so other values are percent-encoded.                                                                                                                                                            |
| [`style: "cookie"`][3.2-style-values]                                                                                                                   | Cookie syntax from RFC 6265, without percent-encoding. 3.1 cookie parameters use `form`, the default left in place.                                                                                                                      |
| Parameter and header [`example`][3.2-parameter-example] / [`examples`][3.2-parameter-examples] beside `content`                                         | 3.1 allows them only with `schema`. Media types inside `content` keep their own examples.                                                                                                                                                |
| A [`content`][3.2-parameter-content] `$ref` that is external, missing, or looping                                                                       | 3.1 `content` maps cannot hold a `$ref`, and only local targets can be inlined. A parameter or header left without `content` is removed too, because it needs exactly one entry.                                                         |
| Media type [`description`][3.2-schema]                                                                                                                  | 3.1 Media Type Objects have no description. The field comes from the official 3.2 JSON Schema, not the spec text.                                                                                                                        |
| [`itemSchema`][3.2-media-type-item-schema] beside `schema`                                                                                              | Validates each item of a stream, such as JSON Lines or server-sent events, which 3.1 cannot express. Alone, it becomes `schema: { type: "array", items: … }`. Beside `schema`, which already describes the whole content, it is dropped. |
| [`prefixEncoding`][3.2-media-type-prefix-encoding] and [`itemEncoding`][3.2-media-type-item-encoding]                                                   | Encode multipart parts by position. 3.1 `encoding` only matches parts by property name.                                                                                                                                                  |
| Encoding Object [`encoding`][3.2-encoding-encoding], [`prefixEncoding`][3.2-encoding-prefix-encoding], and [`itemEncoding`][3.2-encoding-item-encoding] | Encode the parts of a nested multipart part. 3.1 Encoding Objects cannot nest.                                                                                                                                                           |
| Response [`summary`][3.2-response-summary] beside `description`                                                                                         | 3.1 has no `summary` and requires `description`. A summary without a description becomes the description.                                                                                                                                |
| Example [`dataValue`][3.2-example-data-value] and [`serializedValue`][3.2-example-serialized-value]                                                     | 3.1 has only `value`. When `value` and `externalValue` are missing, `dataValue`, or else `serializedValue`, fills it.                                                                                                                    |
| OAuth [`deviceAuthorization`][3.2-oauth-flows-device-authorization] flow                                                                                | The device flow from RFC 8628. 3.1 knows only `implicit`, `password`, `clientCredentials`, and `authorizationCode`, so a scheme with only this flow is left with `flows: {}`.                                                            |
| Security scheme [`oauth2MetadataUrl`][3.2-security-scheme-oauth2-metadata-url]                                                                          | The authorization server metadata URL from RFC 8414. 3.1 has no such field.                                                                                                                                                              |
| Security scheme [`deprecated`][3.2-security-scheme-deprecated]                                                                                          | 3.1 has no such field.                                                                                                                                                                                                                   |
| Links ([`operationRef`][3.2-link-operation-ref]) and discriminator [`mapping`][3.2-discriminator-mapping] entries that point into a removed part        | They would point at nothing.                                                                                                                                                                                                             |

[3.2-self]: https://spec.openapis.org/oas/v3.2.0.html#oas-self
[3.2-components-media-types]: https://spec.openapis.org/oas/v3.2.0.html#components-media-types
[3.2-server-name]: https://spec.openapis.org/oas/v3.2.0.html#server-name
[3.2-tag-summary]: https://spec.openapis.org/oas/v3.2.0.html#tag-summary
[3.2-tag-parent]: https://spec.openapis.org/oas/v3.2.0.html#tag-parent
[3.2-tag-kind]: https://spec.openapis.org/oas/v3.2.0.html#tag-kind
[3.2-path-item-query]: https://spec.openapis.org/oas/v3.2.0.html#path-item-query
[3.2-path-item-additional-operations]: https://spec.openapis.org/oas/v3.2.0.html#path-item-additional-operations
[3.2-parameter-locations]: https://spec.openapis.org/oas/v3.2.0.html#parameter-locations
[3.2-parameter-allow-reserved]: https://spec.openapis.org/oas/v3.2.0.html#parameter-allow-reserved
[3.2-style-values]: https://spec.openapis.org/oas/v3.2.0.html#style-values
[3.2-parameter-example]: https://spec.openapis.org/oas/v3.2.0.html#parameter-example
[3.2-parameter-examples]: https://spec.openapis.org/oas/v3.2.0.html#parameter-examples
[3.2-parameter-content]: https://spec.openapis.org/oas/v3.2.0.html#parameter-content
[3.2-schema]: https://spec.openapis.org/oas/3.2/schema/2025-09-17
[3.2-media-type-item-schema]: https://spec.openapis.org/oas/v3.2.0.html#media-type-item-schema
[3.2-media-type-prefix-encoding]: https://spec.openapis.org/oas/v3.2.0.html#media-type-prefix-encoding
[3.2-media-type-item-encoding]: https://spec.openapis.org/oas/v3.2.0.html#media-type-item-encoding
[3.2-encoding-encoding]: https://spec.openapis.org/oas/v3.2.0.html#encoding-encoding
[3.2-encoding-prefix-encoding]: https://spec.openapis.org/oas/v3.2.0.html#encoding-prefix-encoding
[3.2-encoding-item-encoding]: https://spec.openapis.org/oas/v3.2.0.html#encoding-item-encoding
[3.2-response-summary]: https://spec.openapis.org/oas/v3.2.0.html#response-summary
[3.2-example-data-value]: https://spec.openapis.org/oas/v3.2.0.html#example-data-value
[3.2-example-serialized-value]: https://spec.openapis.org/oas/v3.2.0.html#example-serialized-value
[3.2-oauth-flows-device-authorization]: https://spec.openapis.org/oas/v3.2.0.html#oauth-flows-device-authorization
[3.2-security-scheme-oauth2-metadata-url]: https://spec.openapis.org/oas/v3.2.0.html#security-scheme-oauth2-metadata-url
[3.2-security-scheme-deprecated]: https://spec.openapis.org/oas/v3.2.0.html#security-scheme-deprecated
[3.2-link-operation-ref]: https://spec.openapis.org/oas/v3.2.0.html#link-operation-ref
[3.2-discriminator-mapping]: https://spec.openapis.org/oas/v3.2.0.html#discriminator-mapping

#### Limitations

- Security requirements that name a scheme by URI, and `$self`-relative references, pass through unchanged.
- A Link that names a removed operation (`query` or `additionalOperations`) by `operationId` is kept.
- A `$ref` whose target is removed or moved, such as a `components.mediaTypes` entry or a parameter after a removed one, is replaced by its converted target without the Reference Object's own `summary` and `description`. A Path Item referenced from several places then repeats its `operationId`s, and a target that refers back to itself loses that inner reference.
- `$ref`s that are external, use an `$anchor`, loop, already dangle, or point at a value other than an object or boolean schema are left as written, so they can dangle.

### Schema (`downgradeSchemaV32ToV31`)

Accepts the default OAS dialect. It builds on JSON Schema 2020-12 in both versions, so everything not listed below passes through. Every schema is read as 2020-12, whatever `$schema` or `jsonSchemaDialect` names.

#### Removed

| API                                                                 | Why                                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| XML [`nodeType`][3.2-xml-node-type]                                 | `"attribute"` becomes `attribute: true`, and `"element"` on an array becomes `wrapped: true`. `"text"` and `"cdata"` have no 3.1 equivalent. |
| Discriminator [`defaultMapping`][3.2-discriminator-default-mapping] | Picks the schema when the discriminating property is missing or unmapped. 3.1 has no such field.                                             |

[3.2-xml-node-type]: https://spec.openapis.org/oas/v3.2.0.html#xml-node-type
[3.2-discriminator-default-mapping]: https://spec.openapis.org/oas/v3.2.0.html#discriminator-default-mapping

#### Limitations

- A `$schema` naming the 3.2 dialect passes through unchanged.
- Where a schema inlined for a `$ref` whose target is removed or moved refers back to itself, the inner reference becomes `{}`, so an enclosing `not`, `oneOf`, `if`, or `unevaluated*` can reject values the original accepts.
- Only the first copy of a schema inlined in several places keeps its `$id`, `$anchor`, and `$dynamicAnchor`, so each identifier stays unique. The other copies resolve their relative `$ref`s against the enclosing base instead.
- Older drafts are not supported. Subschemas under keywords that only draft-07 or 2019-09 define, such as `definitions`, pass through unconverted. Convert such schemas to 2020-12 first.

## 3.1 → 3.0

### Spec (`downgradeSpecV31ToV30`)

Schema Objects inside the document convert as in [Schema](#schema-downgradeschemav31tov30).

#### Removed

| API                                                                                                                                                                | Why                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`jsonSchemaDialect`][3.1-json-schema-dialect]                                                                                                                     | 3.0 has one fixed schema dialect.                                                                                                                                                                                                                                |
| [`webhooks`][3.1-webhooks]                                                                                                                                         | 3.0 only describes callbacks tied to an operation. `$ref`s to a webhook are inlined.                                                                                                                                                                             |
| [`components.pathItems`][3.1-components-path-items]                                                                                                                | 3.0 Components hold no Path Items. `$ref`s to them are inlined.                                                                                                                                                                                                  |
| Info [`summary`][3.1-info-summary]                                                                                                                                 | 3.0 has no such field.                                                                                                                                                                                                                                           |
| License [`identifier`][3.1-license-identifier]                                                                                                                     | An SPDX expression. A 3.0 License has only `name` and `url`.                                                                                                                                                                                                     |
| Reference Object [`summary`][3.1-reference-summary], [`description`][3.1-reference-description], and extensions                                                    | A 3.0 Reference Object holds only `$ref`.                                                                                                                                                                                                                        |
| Encoding Object [`style`][3.1-encoding-style], [`explode`][3.1-encoding-explode], and [`allowReserved`][3.1-encoding-allow-reserved] in `multipart` request bodies | 3.1 serializes a `multipart/form-data` part that sets them RFC6570-style, such as an exploded object as one part per property. 3.0 ignores them outside `application/x-www-form-urlencoded`, so the part is sent by its `contentType` or schema default instead. |
| [`mutualTLS`][3.1-security-scheme-type] security schemes, `$ref`s to them, and their names in security requirements                                                | 3.0 has no mutual TLS scheme. An emptied requirement or `security` list is removed too, because an empty one would mean no security. An operation then falls back to the root `security`.                                                                        |
| [Security requirement][3.1-security-requirement-object] scopes on `apiKey` and `http` schemes                                                                      | 3.1 lets them list required roles. 3.0 requires an empty list for schemes other than OAuth2 and OpenID Connect.                                                                                                                                                  |
| Links ([`operationRef`][3.1-link-operation-ref]) and discriminator [`mapping`][3.1-discriminator-mapping] entries that point into a removed part                   | They would point at nothing.                                                                                                                                                                                                                                     |

[3.1-json-schema-dialect]: https://spec.openapis.org/oas/v3.1.2.html#oas-json-schema-dialect
[3.1-webhooks]: https://spec.openapis.org/oas/v3.1.2.html#oas-webhooks
[3.1-components-path-items]: https://spec.openapis.org/oas/v3.1.2.html#components-path-items
[3.1-info-summary]: https://spec.openapis.org/oas/v3.1.2.html#info-summary
[3.1-license-identifier]: https://spec.openapis.org/oas/v3.1.2.html#license-identifier
[3.1-reference-summary]: https://spec.openapis.org/oas/v3.1.2.html#reference-summary
[3.1-reference-description]: https://spec.openapis.org/oas/v3.1.2.html#reference-description
[3.1-encoding-style]: https://spec.openapis.org/oas/v3.1.2.html#encoding-style
[3.1-encoding-explode]: https://spec.openapis.org/oas/v3.1.2.html#encoding-explode
[3.1-encoding-allow-reserved]: https://spec.openapis.org/oas/v3.1.2.html#encoding-allow-reserved
[3.1-security-scheme-type]: https://spec.openapis.org/oas/v3.1.2.html#security-scheme-type
[3.1-security-requirement-object]: https://spec.openapis.org/oas/v3.1.2.html#security-requirement-object
[3.1-link-operation-ref]: https://spec.openapis.org/oas/v3.1.2.html#link-operation-ref
[3.1-discriminator-mapping]: https://spec.openapis.org/oas/v3.1.2.html#discriminator-mapping

#### Limitations

- A Link that names a webhook operation by `operationId` is kept.
- A `$ref` whose target is removed, such as a webhook or a `components.pathItems` entry, is replaced by its converted target. A Path Item referenced from several places then repeats its `operationId`s, and a target that refers back to itself loses that inner reference.
- `$ref`s that are external, use an `$anchor`, loop, already dangle, or point at a value other than an object or boolean schema are left as written, so they can dangle.

### Schema (`downgradeSchemaV31ToV30`)

Accepts the default OAS dialect, which adds `discriminator`, `xml`, `externalDocs`, and `example` to JSON Schema 2020-12. Every schema is read as 2020-12, whatever `$schema` or `jsonSchemaDialect` names.

A schema is _loosened_ when the conversion removes a restriction from it or a subschema, or when it contains an object cycle, as in a dereferenced document.

#### Removed

| API                                                                                                 | Why                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`$schema`][js-schema] and [`$vocabulary`][js-vocabulary]                                           | 3.0 has one fixed dialect.                                                                                                                                                                     |
| [`$id`][js-id] and [`$anchor`][js-anchor]                                                           | 3.0 identifies schemas only by location. `$ref`s through them are left as written.                                                                                                             |
| [`$defs`][js-defs]                                                                                  | 3.0 has no local definitions. Each `$ref` into `$defs` is replaced by its converted target, and a reference back into a target being inlined becomes `{}`, so recursion stops after one level. |
| [`$dynamicRef` and `$dynamicAnchor`][js-dynamic]                                                    | 3.0 has no dynamic references.                                                                                                                                                                 |
| [`$comment`][js-comment] and [`contentSchema`][js-content-schema]                                   | Annotations with no 3.0 equivalent.                                                                                                                                                            |
| [`if`][js-if], [`then`][js-then], and [`else`][js-else]                                             | 3.0 has no conditionals.                                                                                                                                                                       |
| [`dependentSchemas`][js-dependent-schemas] and [`dependentRequired`][js-dependent-required]         | 3.0 has no dependencies.                                                                                                                                                                       |
| [`prefixItems`][js-prefix-items] and its `items`                                                    | 3.0 `items` applies one schema to every item, so tuples become plain arrays.                                                                                                                   |
| [`contains`][js-contains], [`minContains`][js-min-contains], and [`maxContains`][js-max-contains]   | 3.0 has no equivalent.                                                                                                                                                                         |
| [`patternProperties`][js-pattern-properties] and its `additionalProperties`                         | 3.0 has no equivalent. `additionalProperties` goes too, because it would reject properties that `patternProperties` allowed.                                                                   |
| [`propertyNames`][js-property-names]                                                                | 3.0 has no equivalent.                                                                                                                                                                         |
| [`unevaluatedItems`][js-unevaluated-items] and [`unevaluatedProperties`][js-unevaluated-properties] | 3.0 has no equivalent.                                                                                                                                                                         |
| [`contentEncoding`][js-content-encoding] and [`contentMediaType`][js-content-media-type]            | 3.0 marks binary strings with `format` instead: `base64` becomes `format: byte`, and a media type without an encoding becomes `format: binary`. Anything else is lost.                         |
| [`examples`][js-examples]                                                                           | 3.0 has a single `example`. The first entry fills it when missing, and the rest are dropped.                                                                                                   |
| Empty [`enum`][js-enum]                                                                             | 3.0 requires at least one value. An empty `enum` rejects everything, so dropping it only loosens the schema.                                                                                   |
| [`not`][js-not] over a loosened schema                                                              | Negating a looser schema would reject values the original accepts.                                                                                                                             |
| The exclusivity of [`oneOf`][js-one-of] with a loosened branch                                      | Looser branches may overlap, so "exactly one" could reject values the original accepts. It becomes `anyOf`.                                                                                    |
| [`nullable`][3.0-schema-nullable], a 3.0 keyword                                                    | 3.1 ignores it, but in 3.0 it admits null, so keeping it would accept null where the original rejects it. Only `"null"` in `type` becomes `nullable: true`.                                    |
| XML [`nodeType`][3.2-xml-node-type], a 3.2 field                                                    | As in 3.2 → 3.1, kept only as `attribute: true` or `wrapped: true`.                                                                                                                            |

[js-schema]: https://json-schema.org/draft/2020-12/json-schema-core#name-the-schema-keyword
[js-vocabulary]: https://json-schema.org/draft/2020-12/json-schema-core#name-the-vocabulary-keyword
[js-id]: https://json-schema.org/draft/2020-12/json-schema-core#name-the-id-keyword
[js-anchor]: https://json-schema.org/draft/2020-12/json-schema-core#name-defining-location-independe
[js-defs]: https://json-schema.org/draft/2020-12/json-schema-core#name-schema-re-use-with-defs
[js-dynamic]: https://json-schema.org/draft/2020-12/json-schema-core#name-dynamic-references-with-dyn
[js-comment]: https://json-schema.org/draft/2020-12/json-schema-core#name-comments-with-comment
[js-content-schema]: https://json-schema.org/draft/2020-12/json-schema-validation#name-contentschema
[js-if]: https://json-schema.org/draft/2020-12/json-schema-core#name-if
[js-then]: https://json-schema.org/draft/2020-12/json-schema-core#name-then
[js-else]: https://json-schema.org/draft/2020-12/json-schema-core#name-else
[js-dependent-schemas]: https://json-schema.org/draft/2020-12/json-schema-core#name-dependentschemas
[js-dependent-required]: https://json-schema.org/draft/2020-12/json-schema-validation#name-dependentrequired
[js-prefix-items]: https://json-schema.org/draft/2020-12/json-schema-core#name-prefixitems
[js-contains]: https://json-schema.org/draft/2020-12/json-schema-core#name-contains
[js-min-contains]: https://json-schema.org/draft/2020-12/json-schema-validation#name-mincontains
[js-max-contains]: https://json-schema.org/draft/2020-12/json-schema-validation#name-maxcontains
[js-pattern-properties]: https://json-schema.org/draft/2020-12/json-schema-core#name-patternproperties
[js-property-names]: https://json-schema.org/draft/2020-12/json-schema-core#name-propertynames
[js-unevaluated-items]: https://json-schema.org/draft/2020-12/json-schema-core#name-unevaluateditems
[js-unevaluated-properties]: https://json-schema.org/draft/2020-12/json-schema-core#name-unevaluatedproperties
[js-content-encoding]: https://json-schema.org/draft/2020-12/json-schema-validation#name-contentencoding
[js-content-media-type]: https://json-schema.org/draft/2020-12/json-schema-validation#name-contentmediatype
[js-examples]: https://json-schema.org/draft/2020-12/json-schema-validation#name-examples
[js-enum]: https://json-schema.org/draft/2020-12/json-schema-validation#name-enum
[js-not]: https://json-schema.org/draft/2020-12/json-schema-core#name-not
[js-one-of]: https://json-schema.org/draft/2020-12/json-schema-core#name-oneof
[3.0-schema-nullable]: https://spec.openapis.org/oas/v3.0.4.html#schema-nullable

#### Limitations

- Older drafts are not supported. Keywords that only draft-07 or 2019-09 define, such as `definitions`, `dependencies`, array-form `items`, `additionalItems`, and `$recursiveRef`, pass through unconverted. Siblings of a `$ref` apply, although draft-07 ignores them. Convert such schemas to 2020-12 first.
- `$ref`s to an `$anchor` or resolved against an `$id` base are left as written and dangle. Rewrite them as JSON pointers first.
- A `not` or `oneOf` that reaches a loosened schema through a `$ref` kept in the output can reject values the original accepts.
- A schema without `type` that has `contentEncoding: base64`, or `contentMediaType` without `contentEncoding`, gains `type: string`, so non-string values the original accepts are rejected.
- Non-standard keywords are kept, although the official 3.0 schema forbids them.

## Sponsors

Like what we build over at [middleapi](https://github.com/middleapi)? You can help keep it going through [GitHub Sponsors](https://github.com/sponsors/dinwwwh) or [Open Collective](https://opencollective.com/middleapi). Every bit helps! 🚀

<table>
  <tr>
   <td width="2000"><a href="https://screenshotone.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="The screenshot API for developers"><img src="https://avatars.githubusercontent.com/u/97035603?v=4" width="64" align="left" hspace="12" alt="ScreenshotOne.com"/><b>ScreenshotOne.com</b></a><br /><sub>The screenshot API for developers</sub></td>
  </tr>
  <tr>
   <td width="2000"><a href="https://yuzu.health/careers?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="We&#39;re hiring NYC based engineers"><img src="https://avatars.githubusercontent.com/u/102488956?v=4" width="64" align="left" hspace="12" alt="Yuzu"/><b>Yuzu</b></a><br /><sub>We&#39;re hiring NYC based engineers</sub></td>
  </tr>
  <tr>
   <td width="2000"><a href="https://misskey.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Decentralized microblogging SNS born on Earth"><img src="https://github.com/MisskeyIO.png" width="64" align="left" hspace="12" alt="MisskeyHQ"/><b>MisskeyHQ</b></a><br /><sub>Decentralized microblogging SNS born on Earth</sub></td>
  </tr>
</table>

### Special Sponsors

<table>
  <tr>
   <td align="center"><a href="http://twitter.com/rauchg?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Guillermo Rauch"><img src="https://avatars.githubusercontent.com/u/13041?u=1ee8d111657cdd02ff6d253df00978d17ee6d722&amp;v=4" width="279" alt="Guillermo Rauch"/><br />Guillermo Rauch</a></td>
  </tr>
</table>

### Premium Sponsors

<table>
  <tr>
   <td align="center"><a href="https://github.com/nexa-ca?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Nexa"><img src="https://avatars.githubusercontent.com/u/199146462?v=4" width="209" alt="Nexa"/><br />Nexa</a></td>
  </tr>
</table>

### Organization Sponsors

<table>
  <tr>
   <td align="center"><a href="https://lnmarkets.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="LN Markets"><img src="https://avatars.githubusercontent.com/u/70597625?v=4" width="167" alt="LN Markets"/><br />LN Markets</a></td>
  </tr>
</table>

### Sponsors

<table>
  <tr>
   <td align="center"><a href="https://github.com/hrmcdonald?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Reece McDonald"><img src="https://avatars.githubusercontent.com/u/39349270?v=4" width="139" alt="Reece McDonald"/><br />Reece McDonald</a></td>
   <td align="center"><a href="https://soymilk.party/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="あわわわとーにゅ"><img src="https://avatars.githubusercontent.com/u/17376330?u=de3353804be889f009f7e0a1582daf04d0ab292d&amp;v=4" width="139" alt="あわわわとーにゅ"/><br />あわわわとーにゅ</a></td>
   <td align="center"><a href="https://github.com/nicognaW?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="nk"><img src="https://avatars.githubusercontent.com/u/66731869?u=4699bda3a9092d3ec34fbd959450767bcc8b8b6d&amp;v=4" width="139" alt="nk"/><br />nk</a></td>
   <td align="center"><a href="https://supastarter.dev/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="supastarter"><img src="https://avatars.githubusercontent.com/u/110960143?v=4" width="139" alt="supastarter"/><br />supastarter</a></td>
   <td align="center"><a href="https://github.com/herrfugbaum?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="herrfugbaum"><img src="https://avatars.githubusercontent.com/u/12859776?u=644dc1666d0220bc0468eb0de3c56b919f635b16&amp;v=4" width="139" alt="herrfugbaum"/><br />herrfugbaum</a></td>
   <td align="center"><a href="https://laststance.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Ryota Murakami"><img src="https://avatars.githubusercontent.com/u/5501268?u=599389e03340734325726ca3f8f423c021d47d7f&amp;v=4" width="139" alt="Ryota Murakami"/><br />Ryota Murakami</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://cra.mr/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="David Cramer"><img src="https://avatars.githubusercontent.com/u/23610?v=4" width="139" alt="David Cramer"/><br />David Cramer</a></td>
   <td align="center"><a href="https://valerii15298.github.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Valerii Petryniak"><img src="https://avatars.githubusercontent.com/u/44531564?u=88ac74d9bacd20401518441907acad21063cd397&amp;v=4" width="139" alt="Valerii Petryniak"/><br />Valerii Petryniak</a></td>
   <td align="center"><a href="https://letstri.dev/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Valerii Strilets"><img src="https://avatars.githubusercontent.com/u/13253748?u=c7b10399ccc8f8081e24db94ec32cd9858e86ac3&amp;v=4" width="139" alt="Valerii Strilets"/><br />Valerii Strilets</a></td>
   <td align="center"><a href="https://blacklight.sh/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Kyle Mistele"><img src="https://avatars.githubusercontent.com/u/18430555?u=3afebeb81de666e35aaac3ed46f14159d7603ffb&amp;v=4" width="139" alt="Kyle Mistele"/><br />Kyle Mistele</a></td>
   <td align="center"><a href="https://github.com/christ12938?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="christ12938"><img src="https://avatars.githubusercontent.com/u/25758598?v=4" width="139" alt="christ12938"/><br />christ12938</a></td>
   <td align="center"><a href="https://github.com/Ryanjso?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Ryan Soderberg"><img src="https://avatars.githubusercontent.com/u/39172778?u=5ed913c31d57e7221b75784abcad48c7ebddde27&amp;v=4" width="139" alt="Ryan Soderberg"/><br />Ryan Soderberg</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/itigoore01?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="shota"><img src="https://avatars.githubusercontent.com/u/11831107?u=c976a6dc7e055eb026304c46c99100ed22b0c8e0&amp;v=4" width="139" alt="shota"/><br />shota</a></td>
   <td align="center"><a href="https://github.com/ellis-driscoll?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Ellis Driscoll"><img src="https://avatars.githubusercontent.com/u/70685966?u=c5f95bc33b5991d9744abe00052542e4a2ed3cb9&amp;v=4" width="139" alt="Ellis Driscoll"/><br />Ellis Driscoll</a></td>
   <td align="center"><a href="https://github.com/hoangbn?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Hoang Nguyen"><img src="https://avatars.githubusercontent.com/u/38968280?u=c90084c6de65c56facabab7ba13a72a49ddbc3e4&amp;v=4" width="139" alt="Hoang Nguyen"/><br />Hoang Nguyen</a></td>
   <td align="center"><a href="https://opencollective.com/guest-ac41de3b?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Orestis Ioannou"><img src="https://images.opencollective.com/guest-ac41de3b/avatar/460.png" width="139" alt="Orestis Ioannou"/><br />Orestis Ioannou</a></td>
   <td align="center"><a href="https://automatio.ai/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Stefan Smiljkovic"><img src="https://avatars.githubusercontent.com/u/1984909?u=b7bf5bc40ed49df3c22f69d2da7b8d78709c49ed&amp;v=4" width="139" alt="Stefan Smiljkovic"/><br />Stefan Smiljkovic</a></td>
  </tr>
</table>

### Backers

<table>
  <tr>
   <td align="center"><a href="https://github.com/rhinodavid?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="David Walsh"><img src="https://avatars.githubusercontent.com/u/5778036?u=b5521f07d2f88c3db2a0dae62b5f2f8357214af0&amp;v=4" width="119" alt="David Walsh"/><br />David Walsh</a></td>
   <td align="center"><a href="https://github.com/IPv4Addr?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="IPv4Addr"><img src="https://avatars.githubusercontent.com/u/100147665?u=59996b72f69bb53063cb7e9ff8b8f898616cd94d&amp;v=4" width="119" alt="IPv4Addr"/><br />IPv4Addr</a></td>
   <td align="center"><a href="https://robbevaes.be/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Robbe Vaes"><img src="https://avatars.githubusercontent.com/u/44748019?u=e0232402c045ad4eac7cbd217f1f47e083103b89&amp;v=4" width="119" alt="Robbe Vaes"/><br />Robbe Vaes</a></td>
   <td align="center"><a href="https://github.com/aidansunbury?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Aidan Sunbury"><img src="https://avatars.githubusercontent.com/u/64103161?v=4" width="119" alt="Aidan Sunbury"/><br />Aidan Sunbury</a></td>
   <td align="center"><a href="https://github.com/soonoo?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="soonoo"><img src="https://avatars.githubusercontent.com/u/5436405?u=5d0b4aa955c87e30e6bda7f0cccae5402da99528&amp;v=4" width="119" alt="soonoo"/><br />soonoo</a></td>
   <td align="center"><a href="https://kevinporten.dev/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Kevin Porten"><img src="https://avatars.githubusercontent.com/u/1839345?u=dc2263d5cfe0d927ce1a0be04a1d55dd6b55405c&amp;v=4" width="119" alt="Kevin Porten"/><br />Kevin Porten</a></td>
   <td align="center"><a href="https://github.com/pumpkinlink?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Denis"><img src="https://avatars.githubusercontent.com/u/11864620?u=5f47bbe6c65d0f6f5cf011021490238e4b0593d0&amp;v=4" width="119" alt="Denis"/><br />Denis</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/christopher-kapic?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Christopher Kapic"><img src="https://avatars.githubusercontent.com/u/59740769?u=e7ad4b72b5bf6c9eb1644c26dbf3332a8f987377&amp;v=4" width="119" alt="Christopher Kapic"/><br />Christopher Kapic</a></td>
   <td align="center"><a href="http://ballingt.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Tom Ballinger"><img src="https://avatars.githubusercontent.com/u/458879?u=4b045ac75d721b6ac2b42a74d7d37f61f0414031&amp;v=4" width="119" alt="Tom Ballinger"/><br />Tom Ballinger</a></td>
   <td align="center"><a href="https://lee-sam.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Sam"><img src="https://avatars.githubusercontent.com/u/102863520?u=3c89611f549d5070be232eb4532f690c8f2e7a65&amp;v=4" width="119" alt="Sam"/><br />Sam</a></td>
   <td align="center"><a href="https://github.com/Titoine?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Titoine"><img src="https://avatars.githubusercontent.com/u/3514286?u=1bb1e86b0c99c8a1121372e56d51a177eea12191&amp;v=4" width="119" alt="Titoine"/><br />Titoine</a></td>
   <td align="center"><a href="https://rigtch.fm/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Igor Makowski"><img src="https://avatars.githubusercontent.com/u/56691628?u=ee8c879478f7c151b9156aef6c74243fa3e247a8&amp;v=4" width="119" alt="Igor Makowski"/><br />Igor Makowski</a></td>
   <td align="center"><a href="https://blog.cwang.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="hanayashiki"><img src="https://avatars.githubusercontent.com/u/26056783?u=06c3b9205a16fd41a871e82da1cc2a09306d53f5&amp;v=4" width="119" alt="hanayashiki"/><br />hanayashiki</a></td>
   <td align="center"><a href="https://dubinets.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Lev Dubinets"><img src="https://avatars.githubusercontent.com/u/3114081?u=f547f5d5012cab54851f1b1ad72d10e537f78fc2&amp;v=4" width="119" alt="Lev Dubinets"/><br />Lev Dubinets</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://kellychan.im/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Kelly Peilin Chan"><img src="https://avatars.githubusercontent.com/u/520852?u=6b0f7105f694e7b5cacf410a3f04c7044b469dc8&amp;v=4" width="119" alt="Kelly Peilin Chan"/><br />Kelly Peilin Chan</a></td>
   <td align="center"><a href="https://guyariely.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Guy Ariely"><img src="https://avatars.githubusercontent.com/u/42813496?u=edb6b7f563bf28e160a290832e7da57c0506f8ca&amp;v=4" width="119" alt="Guy Ariely"/><br />Guy Ariely</a></td>
   <td align="center"><a href="https://paulsenon.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="PaulSenon"><img src="https://avatars.githubusercontent.com/u/19531087?u=6385741eb91d200b8c513ec6045482e301767ca6&amp;v=4" width="119" alt="PaulSenon"/><br />PaulSenon</a></td>
   <td align="center"><a href="https://nakasyou.how/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Shotaro Nakamura"><img src="https://avatars.githubusercontent.com/u/79000684?u=f644df3f29f0e8677a90967115774564f1d9d6ab&amp;v=4" width="119" alt="Shotaro Nakamura"/><br />Shotaro Nakamura</a></td>
   <td align="center"><a href="https://piscis.dev/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Alex"><img src="https://avatars.githubusercontent.com/u/326163?u=b245f368bd940cf51d08c0b6bf55f8257f359437&amp;v=4" width="119" alt="Alex"/><br />Alex</a></td>
   <td align="center"><a href="https://opensource.gubanov.eu/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Andrey Gubanov"><img src="https://avatars.githubusercontent.com/u/1082083?u=c5f2daf7ebece498e85c83367bb37b4e10e2649d&amp;v=4" width="119" alt="Andrey Gubanov"/><br />Andrey Gubanov</a></td>
  </tr>
</table>

With thanks to [38 past sponsors](https://htmlpreview.github.io/?https://github.com/middleapi/static/blob/main/sponsors.svg) who helped get openapi-spec here.

## License

Distributed under the MIT License. See [LICENSE](https://github.com/middleapi/openapi-spec/blob/main/LICENSE) for more information.
