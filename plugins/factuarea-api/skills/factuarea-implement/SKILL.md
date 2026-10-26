---
name: factuarea-implement
description: Build a Factuarea API integration in the user's own codebase with an official SDK — `@factuarea/sdk` (TypeScript) or `factuarea/factuarea-php` (PHP). Use this when the user is writing application code that calls Factuarea — wiring the client, resolving the API key, creating or listing invoices/contacts/products, paginating, handling errors — and needs the contract invariants right: opaque UUID v7 `id`s, the `data` envelope, cursor pagination, `Idempotency-Key` on writes, and sandbox first. Not for operating the user's own account through MCP tools (that is `factuarea-mcp`); not for the inbound webhook receiver (`factuarea-webhooks`); not for reviewing an integration that is already written (`factuarea-audit`).
---

# Building a Factuarea integration

Factuarea is a multi-tenant invoicing SaaS for Spanish businesses. This skill is
for writing the code that **calls** its public API from the user's own backend.

This is a summary. The **source of truth is the live OpenAPI spec**
(<https://api.factuarea.com/v1/openapi.json> — a **root route**: it describes the
whole v1 surface, so it takes no `/companies/{company}` segment) and the
**published docs**
(<https://docs.factuarea.com>). When you need an exact operation, field name,
enum value or scope, read one of those two. **Never invent a resource, a field
or a scope** — if you cannot find it, say so and stop.

The public API is **included in every Factuarea plan**, trial included.

## Pick the SDK, don't hand-roll HTTP

Use an official SDK unless the project's language rules it out. Both wrap the
full v1 surface and — critically — handle **retries, automatic idempotency keys
and cursor pagination** for you, which is most of what integrations get wrong.

| Stack | Package | Requires |
| --- | --- | --- |
| TypeScript / JavaScript | `@factuarea/sdk` | Node 20+ (also Deno, Bun, Cloudflare Workers) |
| PHP | `factuarea/factuarea-php` | PHP 8.2+ |

Anything else (Go, Python, Ruby, .NET) → plain HTTPS against `https://api.factuarea.com/v1`,
and then **you** own idempotency, retries and pagination. Point the user at
[Generate your own client](https://docs.factuarea.com/sdks#generate-your-own-client)
before writing a client by hand.

### TypeScript

```bash
npm install @factuarea/sdk
```

```ts
import { Factuarea } from "@factuarea/sdk";

const factuarea = new Factuarea({ apiKey: process.env.FACTUAREA_API_KEY! });

// Company resources hang off `/v1/companies/{company}/…`, so the company id is
// the FIRST argument: the `id` that `GET /v1/me` returns in `data.scope[]`.
const company = process.env.FACTUAREA_COMPANY_ID!;

// Single-resource calls return the API envelope `{ data, ... }`.
// Operation results are typed `unknown` in 0.x — cast to the shape you expect.
const created = (await factuarea.invoices.create(company, {
  client_id: "01931b3e-7c4a-7f2e-9a8b-3c5d6e7f8a9b",
  series_id: "01931b3e-7c4a-7f2e-9a8b-000000000001",
  issued_on: "2026-06-05",
  due_on: "2026-07-05",
  lines: [{ description: "Consulting", quantity: 1, unit_price: 1000, tax_rate: 21 }],
})) as { data: { id: string } };

// `list` auto-paginates: it yields the resources themselves, not pages.
for await (const inv of await factuarea.invoices.list(company, { status: "paid" })) {
  console.log((inv as { id: string }).id);
}
```

### PHP

```bash
composer require factuarea/factuarea-php
```

```php
use Factuarea\Sdk\Custom\FactuareaClient;
use Factuarea\Sdk\Models\Operations\PublicApiV1InvoicesListRequest;

$factuarea = FactuareaClient::create(getenv('FACTUAREA_API_KEY'));
$company = getenv('FACTUAREA_COMPANY_ID'); // `data.scope[].id` of GET /v1/me

$response = $factuarea->invoices->publicApiV1InvoicesList(
    new PublicApiV1InvoicesListRequest(company: $company),
);
foreach ($response->paginatedList?->data ?? [] as $invoice) {
    echo $invoice->id, PHP_EOL;
}
```

`FactuareaClient::create()` is the entry point — it wires Bearer auth, retries
and the automatic idempotency hook. Don't build the underlying generated client
directly unless the user needs to override transport.

## Contract invariants you must get right

These hold on every resource. Getting one wrong produces an integration that
works in a demo and breaks in production.

### The key is a secret, and its prefix picks the environment

```ts
new Factuarea({ apiKey: process.env.FACTUAREA_API_KEY! }); // never a literal
```

- `fact_test_…` → **sandbox**: an isolated test company. No VeriFactu submission
  to AEAT, no emails to clients, no outbound webhooks.
- `fact_live_…` → **production**: real data, real side effects.

There is **no environment flag** — the prefix is the whole mechanism. So a
misplaced key doesn't fail loudly, it bills the wrong company. Read it from the
environment, never from source, and **never ship it to a browser or mobile
client**: the API is server-to-server only. Browser code that needs Factuarea
data calls *your* backend, which calls Factuarea.

**Build against `fact_test_` first.** Move to `fact_live_` only when the flow is
correct end to end.

### IDs are opaque UUID v7 under the key `id`

Foreign keys are `*_id` and carry UUIDs too (`client_id`, `series_id`). Receive
them and send them back **as-is**: never parse them, never generate one, never
assume ordering or that they are integers. On create, don't pass an `id` — the
server generates and returns it.

### Reads: the `data` envelope and cursor pagination

Single-resource responses wrap the resource in `data`. List responses are a flat
cursor page:

```json
{ "data": [ /* ... */ ], "has_more": true, "next_cursor": "<id>" }
```

Pass `limit` and `starting_after` (the last item's `id`); loop while `has_more`
is true. **There are no page numbers** — no `page`, no `offset`, no `total`. Code
that computes `page * per_page` is broken against this API. Both SDKs iterate
this for you; see [Pagination](https://docs.factuarea.com/guides/pagination).

The one exception is declared in the spec:
`GET /v1/companies/{company}/pdf-templates` and
`GET /v1/companies/{company}/pdf-commercial-identities` (items under `items`) and
the four `.../presentation-history` lists (items under `data`) are offset lists. They take
`page` and `per_page` (at most 100) and return `meta: { page, per_page, total }`:
read `meta.total` to stop, and do not feed them to the cursor iterator.

### Writes: `Idempotency-Key` on every mutating request

Both official SDKs attach an `Idempotency-Key` to every mutating request
automatically and reuse it across the retries of one logical call, so a retried
`POST` never double-creates. Override it when *you* own the natural key:

```ts
await factuarea.invoices.create(company, body, { idempotencyKey: "order-4711" });
```

On raw HTTP you must send the header yourself. Reuse the same key **only** for
true retries of the same call: reusing it with a *different* body is a `422`
(`idempotency_key_reused`), and a retry that overlaps the first request still
running is a `409` (`idempotency_key_in_use`): wait and retry. See
[Idempotency](https://docs.factuarea.com/guides/idempotency).

### Errors: branch on `code`, never on the message

Failures return a normalized envelope:

```json
{ "error": {
    "type": "invalid_request_error", "code": "...", "message": "...",
    "param": "...", "doc_url": "https://docs.factuarea.com/guides/errors#<code>",
    "request_id": "req_..."
} }
```

`message` is human text **in Spanish** and may be re-worded or localized;
`code` is the stable contract. Branch on `error.code`. On `422` validation,
`error.errors[]` carries one item per failing field — surface all of them, not
just the first. Log `request_id`: it's what support needs.

Both SDKs raise a typed error hierarchy instead — catch those.
Status shape: `422` validation, business-rule violation or an
`Idempotency-Key` reused with another body · `409` duplicate, the same key
still in flight, a lock or a stale version · `429` throttled · `401` bad/absent
key · `403` missing scope or plan. Full catalog:
[Errors](https://docs.factuarea.com/guides/errors) ·
[every code](https://docs.factuarea.com/guides/errors/all).

### Rate limits

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
`X-RateLimit-Reset`; a `429` also carries **`Retry-After`** in seconds. Honour
it — don't retry on a fixed timer. The SDKs back off for you. See
[Rate limits](https://docs.factuarea.com/guides/rate-limits).

### Documents have a lifecycle — use the named transition

Issued documents are fiscal records under Spanish law, not editable rows. Don't
`update` a document to change its state: call the operation that **names** the
transition (send, mark as paid, void, accept, convert). An issued invoice is
corrected with a **rectificativa**, never edited or deleted. See
[Annul vs correct](https://docs.factuarea.com/guides/annul-vs-correct).

## Conditional writes, PDF downloads and document presentation

Contract of the PDF template library, document presentation and invoice business
data. Concepts and exact fields:
[templates](https://docs.factuarea.com/guides/document-templates) ·
[previews and artifacts](https://docs.factuarea.com/guides/pdf-template-previews) ·
[presentations](https://docs.factuarea.com/guides/document-presentations) ·
[invoice business data](https://docs.factuarea.com/guides/invoice-business-data).
Every one of these operations lives on the company axis, and they are cited as
`METHOD /path` (for example `PATCH /v1/companies/{company}/pdf-templates/{template}`).
Method names of the SDKs for the newest operations appear when the SDK is
regenerated from the published spec: look them up in the installed package or
call the operation through the generic client instead of guessing a name.

What every call must respect:

- **Omitted vs `null`.** Absent keys keep the stored value, `null` clears it,
  `[]` empties a list. Build PATCH bodies from the fields the user changed, not
  from a full model with unset properties.
- **Read, then write with the tag.** `GET` returns a strong `ETag`; the `PATCH`
  sends it as `If-Match` (quotes included) and/or the body's `expected_version`.
  `POST` actions (revisions, duplicate, archive, restore) take `expected_version`
  in the body. `412` stale tag, `409` stale version or impact fingerprint, `428`
  precondition missing: re-`GET`, re-evaluate, retry with the new value.
- **Delivery precondition.** When revisioned presentation is active, issuing,
  sending or accepting answers `428
  pdf_presentation_precondition_required` (v1 `mark-delivered` never takes it) unless the request carries the seven
  fields obtained from `POST /v1/companies/{company}/pdf-template-previews` with
  `source: { kind: "persisted_draft", document_id }` (the other sources are `example`, `unsaved_form`, `presentation_revision` and `invoice_substitution`) (flat for invoice
  `issue`/`send`, as `presentation_precondition` for the other documents, as
  `presentation_preconditions` keyed by document id in bulk operations). They are
  all-or-none. The preview artifact must be fresh: if the draft changed, preview
  again (`409 pdf_presentation_context_changed`). Accepting a quote or a
  pro-forma needs them only for its **first capture**: one that already has a
  retained capture (it was shared as a draft, for example) is accepted without
  them, and may cite the capture the user reviewed in
  `expected_presentation_uuid`; if that is no longer the current one, the answer
  is `409 pdf_presentation_conflict` and nothing is written. When the company has not
  activated revisioned presentation the same fields are **ignored** (the call
  behaves as before, with no `422`), so sending them is harmless.
- **Template on a document.** `pdf_template_id` (omit to inherit or keep, `null` to
  clear, UUID to choose), only effective with revisioned presentation active. On a
  new document it is not versioned: omission or `null` inherits the default and
  the document starts its own selection version. On an update, or when a `POST`
  resolves to an existing `external_id`, it travels with `expected_selection_version`
  (both or neither). After issuing, append a revision with
  `POST /v1/companies/{company}/{resource}/{id}/presentation-revisions`.
- **Downloads.** The document downloads
  `GET /v1/companies/{company}/{invoices|quotes|proformas|delivery-notes}/{id}/pdf` answer `200`
  binary, `202` JSON (`pdf_output_state`, `Retry-After`; also when a failed render
  that can be retried was claimed again), `304` with `If-None-Match`,
  `409 pdf_presentation_conflict` (the presentation changed since you read it) or
  `409 pdf_presentation_context_changed` (what you reviewed, or the requested
  `format`, no longer matches), for invoices also `409 pdf_legal_source_changed`
  (create a presentation revision), `500` when no render can produce the PDF
  (`pdf_engine_profile_unavailable`, `pdf_payload_resource_unavailable`,
  `pdf_image_resource_unavailable`, `pdf_original_unavailable`,
  `pdf_original_corrupt` and, for the signed delivery note or the invoice whose
  legal QR or legal data is added, `pdf_original_layout_unavailable`: terminal, do
  not retry),
  `410` (terminal, personal data erased) or `503 pdf_artifact_not_ready` with
  `Retry-After` while another request prepares the same PDF (repeat the same
  request after the delay; the same `503` can come from previews, `prepare`,
  `render` and `pdf-link`).
  `GET /v1/companies/{company}/pdf-artifacts/{artifact}/download` answers `200` binary, `304`, `410`,
  `500` (`pdf_original_unavailable`, `pdf_original_corrupt`) and
  `503 pdf_artifact_not_ready` with `Retry-After`. Rendering an artifact that no
  render can complete answers `500` with its code instead of `200` with
  `state: failed`; the metadata read still shows `failed` with its `error`.
  Always handle all of them.
- **Idempotency is mandatory** on `POST /v1/companies/{company}/pdf-template-previews`,
  `POST /v1/companies/{company}/pdf-artifacts`,
  `POST /v1/companies/{company}/pdf-artifacts/{artifact}/render` and
  `POST /v1/companies/{company}/pdf-templates/assets`. Check `Idempotent-Replayed`
  to know a replay.
  Retrying a `failed` artifact needs a new key.
- **URLs as returned.** Use `publication.public_url` (only when
  `publication.state` is `ready`) and `download_url` unchanged. Publishing a public
  link needs `publication_context` (`presentation_id` + `expected_binding_version`).
  The link's `url`, with no version selector, opens the latest version shared
  publicly; `publication.public_url` pins one version.
- **FACe.** Never resend a submission after `502 face_transmission_failed`,
  `500 face_submission_completion_failed` or `409 face_transmission_uncertain`:
  keep `error.details.attempt_id`, read the attempt and act on its `status`. A
  fresh submission answers `201`; continuing a prepared attempt with
  `submission_id`, or repeating a durable one, answers `200` without a second
  transmission. `status` is one of `prepared`, `transmission_uncertain`,
  `submitted`, `registered_rcf`, `accounted`, `paid`, `rejected`,
  `cancellation_requested`, `cancelled`, `error`.

### TypeScript (`@factuarea/sdk`)

Every method takes a last `config` argument (`RequestConfig`) with
`idempotencyKey`, `ifMatch`, `ifNoneMatch` (literal header values, quotes
included), `noRetry` and `onResponse`. Request bodies are typed per operation;
`undefined` and absent keys are omitted, `null` is sent.

```ts
// Read the ETag of a GET and send it back. `getX` / `patchX` stand for the SDK
// methods of `GET` and `PATCH /v1/companies/{company}/pdf-templates/{template}`
// (names come from the regenerated SDK: look them up in the installed package).
let etag: string | null = null;
await factuarea.getX(company, templateId, { onResponse: (m) => { etag = m.etag; } });
await factuarea.patchX(company, templateId, { name: "Invoices (2026)" }, { ifMatch: etag! });
```

`onResponse(meta)` receives `{ status, headers, requestId, etag, retryAfter,
idempotentReplayed }` and also runs on error responses (a `412` carries the
current `ETag`). `FactuareaError.headers` and `.retryAfter` are set on every
error (`503`, `412`, ...).

`invoices.pdf`, `quotes.pdf`, `proformas.pdf` and `deliveryNotes.pdf` now return
`BinaryOrJsonResponse`, a union discriminated by `kind`. Branch on it; do not
assume bytes:

```ts
const res = await factuarea.invoices.pdf(company, id, undefined, { ifNoneMatch: cachedEtag });
switch (res.kind) {
  case "binary": save(res.body, res.etag); break;               // 200
  case "json": await wait(res.retryAfter ?? 2); /* 202: repeat */ break;
  case "not_modified": useCached(); break;                       // 304
}
```

`invoices.faceSubmissions.submit` and `faceSubmissions.cancel` are sent once
(`noRetry`): the SDK does not retry a transport failure, because the outcome at FACe
may be unknown. Do not wrap them in your own retry loop.

### CLI (`factuarea`)

- Operations that declare conditional headers get `--if-match` and
  `--if-none-match` (literal value, quotes included); an empty value is a usage
  error. `--show-etag` prints `etag: <value>` on stderr without changing stdout.
- Omitted, empty and null are different flags: not passing `--name` omits it,
  `--name ""` / `--tags=` / `--active=false` send the empty value, and
  `--null-<field>` sends `null` (`factuarea series assign-pdf-template S
  --null-pdf-template-id --expected-version 2`). `--null-<field>` together with
  `--<field>` or `-d`/`--data-file` is a usage error. `-d`/stdin bodies keep
  `null`, `[]`, `false`, `0` and exact numeric literals.
- Binary operations: a `200` writes the exact bytes to `-o`/stdout; a `202` prints
  the JSON on stdout (and `retry-after: N` on stderr) without touching the file; a
  `304` is success with empty stdout and a note on stderr:
  `factuarea invoices pdf <id> -o f.pdf --if-none-match '"<etag>"'`.
- Errors with `Retry-After` expose it (`Retry-After: N`, or `error.retry_after` in
  `--json`). The CLI itself retries `429`/`5xx` and honours the header, except on
  the FACe submit and cancel operations, which are never retried.
- Asset upload (`POST /v1/companies/{company}/pdf-templates/assets`, multipart): pass the image as
  `--file-file <path>` and the rest as `--data '{"kind":"logo"}'`;
  `Idempotency-Key` is generated automatically (override with
  `--idempotency-key`). The command group name follows the spec tag: use
  `factuarea --help` or `factuarea docs search` to find it.

### PHP (`factuarea/factuarea-php`)

`FactuareaClient::create()` sets `Factuarea-Version` and the automatic
`Idempotency-Key` as described above. The pinned generated SDK **predates** the
template, presentation and artifact operations: its `spec/openapi.json` already
holds the final contract, but the typed methods and models of the 50 new
operations only exist once a release of the SDK is regenerated from it. Do not write code
against method names that are not in the installed package. What the SDK gives
you meanwhile, all in `Factuarea\Sdk\Custom\`:

- **New operations and bodies the generated models cannot carry.**
  `Request\RawRequest::send($sdk, 'PATCH', '/companies/{company}/pdf-templates/{template}',
  [...options], ['company' => $company, 'template' => $id])` calls any operation
  (path relative to `/v1`, company axis included) through the SDK's own authenticated
  client: Bearer key, pinned `Factuarea-Version`, automatic `Idempotency-Key` on
  mutations, any active `RequestOverrides`. `options` are Guzzle options (`query`,
  `json`, `multipart`, `headers`), path values are URL-encoded, an HTTP error
  status never throws, and nothing is retried. It returns the PSR-7 response. Use
  it for `issue`/`send`/`duplicate` preconditions, line and template fields on
  `create`/`update`, `?submission_id=` on Facturae and FACe `submit` bodies.
- **Explicit `null` and headers on a generated method.** The generated request
  models skip every optional property that is `null`: assigning `null` omits the
  field (which keeps the stored value). To clear a field, name it in `clear` and
  wrap the single SDK call:
  `Request\RequestOverrides::run(fn () => <one SDK call>, clear: ['pdf_template_id'],
  headers: ['If-Match' => $etag])`. Paths are JSON keys (dot-separated for nested
  objects); only the named paths are sent as `null`, and clearing a field that also
  carries a value is rejected. The `headers` argument sends `If-Match` and
  `If-None-Match`, which the generated methods do not declare. With `RawRequest`
  you simply put `null` in the `json` body.
- **Status and headers.** `Response\ResponseMeta::fromResponse($response)` or
  `::fromException($apiException)` gives `statusCode`, `etag`, `retryAfter`
  (seconds) and `json()`. A status the generated method does not declare raises
  `APIException` even when it is a success: read the `202` (PDF still being
  prepared) of the four `.../pdf` downloads and the `200` replay of FACe `submit`
  with `fromException`, wait `retryAfter` and repeat; do not treat them as
  failures. The generated `pdf_link` method cannot parse one of the two `202`
  bodies of the contract (it has no `pdf_path`) and throws
  `Speakeasy\Serializer\Exception\PropertyMissingException`: call that endpoint
  with `RawRequest` and `ResponseMeta::json()`.
- **FACe is never retried blindly.** The generated methods still retry `429` and
  `5xx` until the SDK is regenerated. Pass `options: Request\NoRetry::options()`
  to FACe `submit` and `cancel`; a dropped connection is still retried with the
  same `Idempotency-Key`, which the API answers by replaying the first outcome.
  A per-call `Options::setRetryConfig()` is ignored by the generated methods;
  configure the other retries on the builder.
- **Statuses with a typed error.** `428`, `409`, `410` and `412` arrive as
  `ErrorThrowable` (declared codes) or `APIException`; branch on the code in
  `container->error->code` or in `json_decode($e->body)`.

`examples/document-templates.php` in the SDK repository shows these calls. Method
names after the regeneration follow the usual rule (the `operationId` in camel
case after a `publicApiV1` prefix); look them up in the installed package.

## Before you finish

- Every field, enum and operation you used appears in the live spec or the docs.
  If you guessed one, remove it and look it up.
- The key comes from the environment and the code runs server-side.
- Writes are idempotent, reads paginate by cursor, errors branch on `code`.
- Conditional writes send the `ETag` or version just read; PDF downloads handle 200, 202, 304 and 503; `null` is sent only to clear.
- The user knows they are pointed at the sandbox, and how to switch.

For the endpoint that **receives** webhook deliveries, use the
`factuarea-webhooks` skill — it has the signature-verification contract.

## Documentation (source of truth)

- Docs home: <https://docs.factuarea.com> · SDKs: <https://docs.factuarea.com/sdks>
  ([TypeScript](https://docs.factuarea.com/sdks/typescript) ·
  [PHP](https://docs.factuarea.com/sdks/php))
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json> — **root route**: it describes the whole v1 surface, so it takes no `/companies/{company}` segment
- Authentication: <https://docs.factuarea.com/guides/authentication> ·
  API keys: <https://docs.factuarea.com/guides/api-keys>
- Idempotency: <https://docs.factuarea.com/guides/idempotency> ·
  Pagination: <https://docs.factuarea.com/guides/pagination> ·
  Rate limits: <https://docs.factuarea.com/guides/rate-limits>
- Errors: <https://docs.factuarea.com/guides/errors>
- Dashboard / API keys: <https://app.factuarea.com/settings/developers/api-keys>
- Support: <https://docs.factuarea.com/support> · contact: `info@factuarea.com`
