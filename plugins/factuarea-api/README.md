# factuarea-api

Skills for **building** on the [Factuarea](https://factuarea.com) public API —
invoicing, quotes, clients, suppliers, products, VeriFactu (AEAT) and webhooks
for Spanish businesses.

This plugin is about the code you write in **your own repository**. It declares
**no MCP server**: nothing to authorise, no tools loaded into the session. The
skills work from the official SDKs, the live OpenAPI spec and the published
docs.

> Want Claude to act on your Factuarea account instead — list unpaid invoices,
> create a draft, check the VeriFactu chain? That is the sibling plugin,
> [`factuarea-mcp`](../factuarea-mcp). They are complementary; teams building an
> integration usually install both.

## Install

In Claude Code:

```text
/plugin marketplace add factuarea/claude-plugins
/plugin install factuarea-api@factuarea
```

`/plugin marketplace add` registers this catalog; `/plugin install` installs the
plugin from it. To update later, run `/plugin marketplace update factuarea`.

## The five skills

| Skill | Activates when you're… |
| --- | --- |
| `factuarea-api` | Starting out, or asking what the API supports, how auth works, or what the docs say about something. The entry point — it routes to the other four |
| `factuarea-implement` | Writing application code that calls the API with the official TypeScript or PHP SDK |
| `factuarea-webhooks` | Building the endpoint that receives deliveries — signature verification, dedup, acknowledgement |
| `factuarea-audit` | Reviewing an integration that is already written, against the contract's rules |
| `factuarea-upgrade` | Realigning code after a spec change or an SDK bump |

They load by context; you can also invoke one by name, e.g.
`/factuarea-api:factuarea-webhooks`.

### `factuarea-api` — where to start

- **Ten golden rules** — sandbox first, the key prefix as the only environment
  switch, server-side only, `Idempotency-Key` on writes, opaque UUID v7 ids,
  cursor pagination, branching on `error.code`, document lifecycle transitions,
  `Retry-After`, raw-body signature verification. Each one points at the skill
  that goes deep.
- **Documentation lookup that stays on the machine** — `factuarea docs
  list|grep|get` downloads the published corpus once, caches it for 15 minutes
  and filters **locally**, with no API key and without the search term leaving
  the machine. Plus `factuarea docs search` over the OpenAPI spec embedded in
  the binary, which never touches the network at all. Fallbacks for when the CLI
  isn't installed.
- **Authentication and environments** — the two accepted headers and which wins,
  what the `fact_test_` sandbox switches off, the `Factuarea-Version` and
  `X-RateLimit-*` response headers, and the shape of the error envelope.
- **Recipes** that route to the right skill.

### `factuarea-implement` — building the integration

- **Choosing the SDK** — `@factuarea/sdk` (Node 20+) or `factuarea/factuarea-php`
  (PHP 8.2+), and what you take on by hand-rolling HTTP instead.
- **Contract invariants** — opaque UUID v7 `id`s, the `data` envelope, cursor
  pagination (`has_more` / `next_cursor`, never page numbers), `Idempotency-Key`
  on writes, and the key prefix as the only environment switch.
- **Server-side only** — why there is no browser-safe key, and sandbox first.

### `factuarea-webhooks` — receiving deliveries

- **The real delivery headers** — `Factuarea-Signature`, `Factuarea-Event-Id`,
  `Factuarea-Event-Type`, `Factuarea-Delivery-Id`, and `Idempotency-Key` carrying
  the event id.
- **Verification** — HMAC-SHA256 over the **raw** body, constant-time compare,
  ±5 min tolerance, and accepting **any** of the `v1` values so a secret rotation
  doesn't reject a day of traffic.
- **Reliability** — dedup by event id, fast 2xx with deferred work, the retry
  schedule, out-of-order tolerance, and `factuarea listen` for the local loop.

### `factuarea-audit` — reviewing what's already written

- **Six rule families** — webhook signature, idempotency, API-key exposure, error
  handling by `code`, rate limits, document lifecycle.
- **Findings with a severity, a `file:line` and a concrete fix** — and explicit
  exemptions per rule, so code that already does the right thing isn't flagged.

### `factuarea-upgrade` — after a contract or SDK change

- **Drift detection** against the live spec and the published SDK versions.
- **Breaking vs additive** by the published versioning policy, including how a
  dated `Factuarea-Version` pin changes the answer.
- **An ordered plan** — breaking first, verified in the sandbox.

## Resources

- Docs home: <https://docs.factuarea.com>
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json>
- SDKs: <https://docs.factuarea.com/sdks> —
  [TypeScript](https://docs.factuarea.com/sdks/typescript) ·
  [PHP](https://docs.factuarea.com/sdks/php)
- CLI: <https://docs.factuarea.com/cli>
- Dashboard / API keys: <https://app.factuarea.com/settings/developers/api-keys>
- Support: <https://docs.factuarea.com/support> · beta access: `info@factuarea.com`

## License

[MIT](../../LICENSE)
