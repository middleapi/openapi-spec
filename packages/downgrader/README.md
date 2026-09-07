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

`@openapi-spec/downgrader` downgrades [OpenAPI Specification](https://spec.openapis.org/) documents one minor version at a time: 3.2 to 3.1 and 3.1 to 3.0. Use it when you author against a newer version than your tools accept, such as a code generator, gateway, or validator that stops at 3.0 or 3.1. Each converter handles a whole document or a single Schema Object.

Every converter follows the same contract:

- **Never throws.** Malformed parts are deep-copied through unchanged instead of failing the whole conversion. Cyclic object graphs, such as the output of a `$ref` dereferencer, convert with their cycles preserved. Only pathologically deep nesting (thousands of levels) can still exhaust the call stack.
- **Never mutates.** The input is left untouched and the result is a new object.
- **Preserves extensions, never invents them.** `x-` keys and unknown keys survive. Constructs the target version cannot express are converted where an equivalent exists and removed otherwise.

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

All types come from [`@openapi-spec/types`](https://github.com/middleapi/openapi-spec/blob/main/packages/types/README.md).

## 3.2 → 3.1

Schema Objects pass through unchanged. 3.2 keeps the 3.1 JSON Schema keyword set and only adds two fields to the OAS vocabulary, `discriminator.defaultMapping` and `xml.nodeType`, and both are kept. 3.1 tooling ignores them, so a `defaultMapping` fallback stops taking effect, while `nodeType` is picked up again on the 3.1 → 3.0 hop. The standard OpenAPI 3.1 document schema accepts them, but the strict OAS 3.1 base-vocabulary meta-schema closes the XML and Discriminator Objects and will flag them.

Converted:

| 3.2 construct                                                              | 3.1 result                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi: 3.2.x`                                                           | `openapi: 3.1.2`                                                                                                                                                                                                                                                                                                |
| `jsonSchemaDialect` naming a 3.2 OAS dialect                               | `https://spec.openapis.org/oas/3.1/dialect/base`; other dialects pass through                                                                                                                                                                                                                                   |
| `components.mediaTypes` and content-map `$ref`s to it                      | references inlined and the component map removed. Entries whose target cannot be inlined (external, unknown, or cyclic) are removed, since 3.1 content maps cannot hold references. A parameter or header that loses its entire `content` that way is removed too, because 3.1 requires exactly one entry there |
| media type `itemSchema` without a sibling `schema`                         | `schema: { type: "array", items: … }`, the sequential media type data model                                                                                                                                                                                                                                     |
| response `summary` without a `description`                                 | promoted to `description`; `""` when neither exists, since 3.1 requires it                                                                                                                                                                                                                                      |
| example `dataValue` / `serializedValue` without `value` or `externalValue` | promoted to `value`, `dataValue` taking precedence                                                                                                                                                                                                                                                              |
| parameter `style: "cookie"`                                                | removed so the 3.1 default `form` applies                                                                                                                                                                                                                                                                       |

Removed, with no 3.1 equivalent:

- `$self`
- server `name`
- tag `summary`, `parent`, and `kind`
- the Path Item `query` operation and `additionalOperations`
- `in: "querystring"` parameters, in parameter lists and in `components.parameters`, together with references to removed component parameters and headers (chains of reference aliases included)
- `allowReserved` on non-query parameters
- media type `description`
- `prefixEncoding`, `itemEncoding`, and nested `encoding` on media types and encodings
- `itemSchema` beside an existing `schema`, and response `summary` beside an existing `description`
- OAuth `deviceAuthorization` flows
- security scheme `oauth2MetadataUrl` and `deprecated`

Known limitations: security requirements keyed by URI, `$self`-relative reference resolution, and a `$schema` keyword inside a Schema Object that names the 3.2 dialect all pass through unchanged.

## 3.1 → 3.0

Converted:

| 3.1 construct                                              | 3.0 result                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `openapi: 3.1.x`                                           | `openapi: 3.0.4`                                                       |
| missing `paths`                                            | `{}` (required in 3.0)                                                 |
| missing operation `responses`                              | `{ "default": { "description": "" } }` (required and non-empty in 3.0) |
| path parameters without `required: true`                   | `required: true` added (mandatory for `in: "path"`)                    |
| Reference Object `summary` / `description`                 | removed (3.0 references carry no overrides)                            |
| security requirement scopes on `apiKey` and `http` schemes | emptied to `[]`                                                        |

Removed, with no 3.0 equivalent:

- `webhooks`
- `jsonSchemaDialect`
- `info.summary` and `license.identifier`
- `components.pathItems`. Path Item `$ref`s to it, in `paths` and in callbacks, are inlined first, following reference chains, with the referencing Path Item's own fields winning over inlined ones. A reference that cannot be inlined (unknown or cyclic target) is left as is and will dangle.
- `mutualTLS` security schemes, reference aliases included. Their names are stripped from every security requirement, a requirement left empty is removed, and a `security` list left empty is removed entirely, since an explicit empty list means "no security required" and would make the operation public.

Schema Objects:

| 3.1 construct                                                          | 3.0 result                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true` / `false` boolean schemas                                       | `{}` / `{ not: {} }`                                                                                                                                                                                                              |
| `$ref` with sibling keywords                                           | siblings kept, `$ref` moved into `allOf`                                                                                                                                                                                          |
| `type: ["T", "null"]`                                                  | `type: "T"` plus `nullable: true`                                                                                                                                                                                                 |
| `type` with several non-null entries                                   | `anyOf` of single-type schemas, each `nullable` when `null` was listed                                                                                                                                                            |
| `type: "null"`                                                         | `nullable: true` plus `enum: [null]`. A sibling `enum` or `const` is intersected with the null type: an `enum` containing `null` collapses to `[null]`, and one excluding it yields `not: {}`, since the source accepted no value |
| `const`                                                                | single-value `enum`, plus `nullable: true` when the value is `null`                                                                                                                                                               |
| numeric `exclusiveMinimum` / `exclusiveMaximum`                        | `minimum` / `maximum` plus the boolean flag; a tighter existing bound wins                                                                                                                                                        |
| `examples`                                                             | first entry becomes `example` when none exists                                                                                                                                                                                    |
| `contentEncoding: base64`                                              | `format: byte` when no `format` exists                                                                                                                                                                                            |
| `contentMediaType: application/octet-stream` without `contentEncoding` | `format: binary` when no `format` exists                                                                                                                                                                                          |
| `type: "array"` without `items`                                        | `items: {}` added (required in 3.0)                                                                                                                                                                                               |
| `enum: []`                                                             | removed (3.0 requires a non-empty `enum`)                                                                                                                                                                                         |
| `required: []` / duplicate `required` entries                          | removed / deduplicated (3.0 requires a non-empty, unique `required`)                                                                                                                                                              |
| XML `nodeType`, carried over from a 3.2 chain                          | `attribute: true` / `wrapped: true` where expressible, then removed (3.0 forbids unknown XML Object fields)                                                                                                                       |

Removed, with no 3.0 equivalent: `$schema`, `$id`, `$defs`, `$anchor`, `$dynamicRef`, `$dynamicAnchor`, `$vocabulary`, `$comment`, `if` / `then` / `else`, `dependentSchemas`, `dependentRequired`, `prefixItems` (with its trailing `items`), `contains`, `minContains`, `maxContains`, `patternProperties` (with its sibling `additionalProperties`, whose meaning would otherwise tighten onto the pattern-matched keys), `propertyNames`, `unevaluatedItems`, `unevaluatedProperties`, and `contentSchema`. In positive schema positions dropping these only loosens validation, the safe direction for a downgrade.

Known limitations:

- `$ref`s into dropped keywords (`#/…/$defs/…` pointers, `$anchor` targets, `$id`-based bases) will dangle. Hoist reusable subschemas into `components.schemas` before downgrading.
- Non-standard schema keywords are preserved per the extension contract, even though the official 3.0 schema forbids unknown Schema Object fields.
- Dropping keywords inside `not`, where loosening the operand tightens the whole, or inside `oneOf` branches, where loosening one branch can break exclusivity, can change what validates.

## Sponsors

Like what we build over at [middleapi](https://github.com/middleapi)? You can help keep it going through [GitHub Sponsors](https://github.com/sponsors/dinwwwh) or [Open Collective](https://opencollective.com/middleapi). Every bit helps! 🚀

<table>
  <tr>
   <td width="2000"><a href="https://screenshotone.com/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener" title="The screenshot API for developers"><img src="https://avatars.githubusercontent.com/u/97035603?v=4" width="64" align="left" hspace="12" alt="ScreenshotOne.com"/><b>ScreenshotOne.com</b></a><br /><sub>The screenshot API for developers</sub></td>
  </tr>
  <tr>
   <td width="2000"><a href="https://yuzu.health/careers?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="We&#39;re hiring NYC based engineers"><img src="https://avatars.githubusercontent.com/u/102488956?v=4" width="64" align="left" hspace="12" alt="Yuzu"/><b>Yuzu</b></a><br /><sub>We&#39;re hiring NYC based engineers</sub></td>
  </tr>
  <tr>
   <td width="2000"><a href="https://misskey.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Decentralized microblogging SNS born on Earth"><img src="https://github.com/MisskeyIO.png" width="64" align="left" hspace="12" alt="MisskeyHQ"/><b>MisskeyHQ</b></a><br /><sub>Decentralized microblogging SNS born on Earth</sub></td>
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
   <td align="center"><a href="https://github.com/divmgl?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Dexter Miguel"><img src="https://avatars.githubusercontent.com/u/5452298?u=645993204be8696c085ecf0d228c3062efe2ed65&amp;v=4" width="139" alt="Dexter Miguel"/><br />Dexter Miguel</a></td>
   <td align="center"><a href="https://github.com/herrfugbaum?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="herrfugbaum"><img src="https://avatars.githubusercontent.com/u/12859776?u=644dc1666d0220bc0468eb0de3c56b919f635b16&amp;v=4" width="139" alt="herrfugbaum"/><br />herrfugbaum</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://laststance.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Ryota Murakami"><img src="https://avatars.githubusercontent.com/u/5501268?u=599389e03340734325726ca3f8f423c021d47d7f&amp;v=4" width="139" alt="Ryota Murakami"/><br />Ryota Murakami</a></td>
   <td align="center"><a href="https://cra.mr/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="David Cramer"><img src="https://avatars.githubusercontent.com/u/23610?v=4" width="139" alt="David Cramer"/><br />David Cramer</a></td>
   <td align="center"><a href="https://valerii15298.github.io/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Valerii Petryniak"><img src="https://avatars.githubusercontent.com/u/44531564?u=88ac74d9bacd20401518441907acad21063cd397&amp;v=4" width="139" alt="Valerii Petryniak"/><br />Valerii Petryniak</a></td>
   <td align="center"><a href="https://letstri.dev/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Valerii Strilets"><img src="https://avatars.githubusercontent.com/u/13253748?u=c7b10399ccc8f8081e24db94ec32cd9858e86ac3&amp;v=4" width="139" alt="Valerii Strilets"/><br />Valerii Strilets</a></td>
   <td align="center"><a href="https://blacklight.sh/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Kyle Mistele"><img src="https://avatars.githubusercontent.com/u/18430555?u=3afebeb81de666e35aaac3ed46f14159d7603ffb&amp;v=4" width="139" alt="Kyle Mistele"/><br />Kyle Mistele</a></td>
   <td align="center"><a href="https://github.com/christ12938?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="christ12938"><img src="https://avatars.githubusercontent.com/u/25758598?v=4" width="139" alt="christ12938"/><br />christ12938</a></td>
  </tr>
  <tr>
   <td align="center"><a href="https://github.com/Ryanjso?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Ryan Soderberg"><img src="https://avatars.githubusercontent.com/u/39172778?u=5ed913c31d57e7221b75784abcad48c7ebddde27&amp;v=4" width="139" alt="Ryan Soderberg"/><br />Ryan Soderberg</a></td>
   <td align="center"><a href="https://github.com/itigoore01?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="shota"><img src="https://avatars.githubusercontent.com/u/11831107?u=c976a6dc7e055eb026304c46c99100ed22b0c8e0&amp;v=4" width="139" alt="shota"/><br />shota</a></td>
   <td align="center"><a href="https://github.com/ellis-driscoll?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Ellis Driscoll"><img src="https://avatars.githubusercontent.com/u/70685966?u=c5f95bc33b5991d9744abe00052542e4a2ed3cb9&amp;v=4" width="139" alt="Ellis Driscoll"/><br />Ellis Driscoll</a></td>
   <td align="center"><a href="https://github.com/hoangbn?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Hoang Nguyen"><img src="https://avatars.githubusercontent.com/u/38968280?u=c90084c6de65c56facabab7ba13a72a49ddbc3e4&amp;v=4" width="139" alt="Hoang Nguyen"/><br />Hoang Nguyen</a></td>
   <td align="center"><a href="https://opencollective.com/guest-ac41de3b?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Orestis Ioannou"><img src="https://images.opencollective.com/guest-ac41de3b/avatar/460.png" width="139" alt="Orestis Ioannou"/><br />Orestis Ioannou</a></td>
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
   <td align="center"><a href="https://piscis.dev/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Alex"><img src="https://avatars.githubusercontent.com/u/326163?u=b245f368bd940cf51d08c0b6bf55f8257f359437&amp;v=4" width="119" alt="Alex"/><br />Alex</a></td>
   <td align="center"><a href="https://opensource.gubanov.eu/?ref=middleapi&amp;utm_source=middleapi&amp;utm_medium=sponsor" target="_blank" rel="noopener sponsored" title="Andrey Gubanov"><img src="https://avatars.githubusercontent.com/u/1082083?u=c5f2daf7ebece498e85c83367bb37b4e10e2649d&amp;v=4" width="119" alt="Andrey Gubanov"/><br />Andrey Gubanov</a></td>
  </tr>
</table>

With thanks to [36 past sponsors](https://htmlpreview.github.io/?https://github.com/middleapi/static/blob/main/sponsors.svg) who helped get openapi-spec here.

## License

Distributed under the MIT License. See [LICENSE](https://github.com/middleapi/openapi-spec/blob/main/LICENSE) for more information.
