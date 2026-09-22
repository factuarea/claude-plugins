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

The API is in **private beta**: companies must be allowlisted before keys work.

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

// Single-resource calls return the API envelope `{ data, ... }`.
// Operation results are typed `unknown` in 0.x — cast to the shape you expect.
const created = (await factuarea.invoices.create({
  client_id: "01931b3e-7c4a-7f2e-9a8b-3c5d6e7f8a9b",
  series_id: "01931b3e-7c4a-7f2e-9a8b-000000000001",
  issued_on: "2026-06-05",
  due_on: "2026-07-05",
  lines: [{ description: "Consulting", quantity: 1, unit_price: 1000, tax_rate: 21 }],
})) as { data: { id: string } };

// `list` auto-paginates: it yields the resources themselves, not pages.
for await (const inv of await factuarea.invoices.list({ status: "paid" })) {
  console.log((inv as { id: string }).id);
}
```

### PHP

```bash
composer require factuarea/factuarea-php
```

```php
use Factuarea\Sdk\Custom\FactuareaClient;

$factuarea = FactuareaClient::create(getenv('FACTUAREA_API_KEY'));

$response = $factuarea->invoices->publicApiV1InvoicesList();
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

### Writes: `Idempotency-Key` on every mutating request

Both official SDKs attach an `Idempotency-Key` to every mutating request
automatically and reuse it across the retries of one logical call, so a retried
`POST` never double-creates. Override it when *you* own the natural key:

```ts
await factuarea.invoices.create(body, { idempotencyKey: "order-4711" });
```

On raw HTTP you must send the header yourself. Reuse the same key **only** for
true retries of the same call: reusing it with a *different* body is a `409`
(`idempotency_key_reused`). See
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
Status shape: `422` validation or business-rule violation · `409` duplicate,
idempotency conflict or lock · `429` throttled · `401` bad/absent key ·
`403` missing scope or plan. Full catalog:
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

## Before you finish

- Every field, enum and operation you used appears in the live spec or the docs.
  If you guessed one, remove it and look it up.
- The key comes from the environment and the code runs server-side.
- Writes are idempotent, reads paginate by cursor, errors branch on `code`.
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
- Support: <https://docs.factuarea.com/support> · beta access: `info@factuarea.com`
