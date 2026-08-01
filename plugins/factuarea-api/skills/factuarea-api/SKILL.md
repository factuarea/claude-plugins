---
name: factuarea-api
description: Entry point for building on the Factuarea public API — invoicing, quotes, clients, suppliers, products, VeriFactu (AEAT) and webhooks for Spanish businesses. Use this when the user says they want to integrate with Factuarea, asks where to start, asks whether the API supports something, asks how to authenticate or which environment a key points at, or needs to find what the Factuarea documentation says about a topic. Carries the non-negotiable rules of the contract, how to look anything up locally with `factuarea docs`, and routes the job to the skill that owns it — `factuarea-implement` to write the calls, `factuarea-webhooks` for the receiver endpoint, `factuarea-audit` to review code already written, `factuarea-upgrade` after a contract or SDK change. Once the task is one of those four, hand over instead of answering here. Not for operating an existing Factuarea account through MCP tools — that is the separate `factuarea-mcp` plugin.
---

# Integrating with Factuarea

Factuarea is a multi-tenant invoicing SaaS for Spanish businesses. Its public
API (`https://api.factuarea.com/v1`) covers invoices, quotes, pro-formas,
delivery notes, recurring and purchase invoices, clients, suppliers, products,
document series, taxes, VeriFactu (AEAT) and webhooks.

This skill is the **orientation layer**: the rules that hold everywhere, how to
look anything up, and who takes it from here. It deliberately does not repeat
what the four specialised skills cover in depth — when the task has a shape,
hand it over.

The API is in **private beta**: a company has to be allowlisted before its keys
work. Request access at `info@factuarea.com`.

## The golden rules

Ten rules. Breaking any of them produces an integration that demos fine and
fails in production. Each one names the skill that goes deep on it.

1. **Never invent.** Not a resource, not a field, not an enum value, not a
   scope. Look it up (next section). If you cannot find it, say so and stop.
2. **Sandbox first.** Build against a `fact_test_` key, move to `fact_live_`
   only when the flow is right end to end. → `factuarea-implement`
3. **The key prefix is the only environment switch.** There is no flag, no
   parameter, no base-URL variant. A misplaced key does not fail loudly — it
   writes to the wrong company. → `factuarea-implement`
4. **Server-side only.** There is no browser-safe key. Client code calls *your*
   backend, which calls Factuarea. → `factuarea-audit` (`FCT-KEY-*`)
5. **`Idempotency-Key` on every mutating request.** A retried `POST` without one
   is a duplicate invoice. → `factuarea-implement`, `factuarea-audit`
6. **IDs are opaque UUID v7 under `id`.** Never parse them, never generate one,
   never assume they sort or that they are integers. → `factuarea-implement`
7. **Paginate by cursor**, never by page number: `{ data, has_more,
   next_cursor }`. → `factuarea-implement`
8. **Branch on `error.code`, never on the message** — messages are localised and
   will change. Log `error.request_id` on every failure. → `factuarea-audit`
9. **Documents have a lifecycle.** Move them with the named transition; never
   write a `status` field, never edit or delete an issued document — issue a
   corrective one. → `factuarea-audit` (`FCT-DOC-*`)
10. **Verify the webhook signature over the raw body before doing anything
    else**, and deduplicate by `Factuarea-Event-Id`. → `factuarea-webhooks`

## Where to look things up

Two sources of truth, both live:

- **The OpenAPI spec** — <https://api.factuarea.com/v1/openapi.json>. Exact
  operations, paths, request and response schemas, enum values, scopes.
- **The published docs** — <https://docs.factuarea.com>. Guides, concepts, the
  error catalogue, the SDK pages.

### Preferred: search the docs locally with the CLI

The Factuarea CLI carries a `docs` group that answers both kinds of question
**without an API key and without your search term leaving the machine**:

```bash
factuarea docs search invoice           # operations, from the spec embedded in the binary
factuarea docs list                     # every published page: <path> — <title>
factuarea docs list /guides             # only what hangs off that prefix
factuarea docs grep "idempotency-key"   # sections of the docs that match
factuarea docs get /guides/idempotency  # one page, full Markdown
```

Two different backends, and the distinction matters when choosing:

| Command | Reads | Answers | Network |
| --- | --- | --- | --- |
| `docs search` | the OpenAPI spec **embedded in the binary** | *which call do I make?* — command, summary, method, path | never |
| `docs list` · `grep` · `get` | the **published corpus** (`llms-full`), cached on disk | *what do the docs say about this?* — pages and sections | only to refresh the cache |

Why this beats fetching a doc page per question:

- **The corpus is downloaded whole, once.** It lands in the system cache
  directory (`~/Library/Caches/factuarea/docs/` on macOS, `~/.cache/factuarea/docs/`
  on Linux) and is filtered **locally**. While the copy is under **15 minutes**
  old there is no request at all, so a session that chains `list`, `grep` and
  `get` downloads a single time.
- **The query never leaves the machine.** The URL fetched is fixed and does not
  depend on what you searched for, and the request carries no credentials.
- **It degrades instead of failing.** If the refresh fails but a cached copy
  exists — even an expired one — that copy is served and the warning goes to
  **stderr**, so `--json` on stdout stays parseable. With no copy at all the
  command exits `10` (network).

| Flag | Effect |
| --- | --- |
| `--refresh` | Force the download, ignoring a still-valid copy |
| `--lang en\|es\|ca` | Language of the guides (default `en`, the source language). The API reference is not translated and is always included |
| `--json` | Stable stdout — `path`/`title` for `list`, `path`/`title`/`section`/`snippet` for `grep`, `path`/`title`/`markdown` for `get` |

`FACTUAREA_DOCS_URL` repoints the corpus at another origin.

### If the CLI isn't there

`docs list|grep|get` landed after CLI **v0.1.3** — check with
`factuarea docs --help` before relying on them. When the CLI is missing or too
old, fetch the same corpus directly and search it yourself:

- <https://docs.factuarea.com/llms-full.en.txt> — every English page as one
  Markdown file (this is exactly what the CLI caches).
- <https://docs.factuarea.com/llms-full.txt> — the three languages together.
- <https://docs.factuarea.com/llms.txt> — a curated index, when the full corpus
  is more than the task needs.

Installing the CLI: <https://docs.factuarea.com/cli>.

## Authentication and environments

Every request carries an API key bound to **one company**. Two accepted headers
— send only one; if both are present, `Authorization: Bearer` wins:

```http
Authorization: Bearer fact_live_xxxxxxxxxxxxxxxxxxxxxxxx
X-API-Key: fact_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

The prefix decides the environment, and nothing else does:

| Prefix | Environment | External effects |
| --- | --- | --- |
| `fact_test_` | isolated sandbox company | VeriFactu/AEAT submission, client emails and outbound webhooks are **off** |
| `fact_live_` | production | all real |

The API surface is identical in both, so a flow built in the sandbox works
unchanged in production.

Two response headers worth wiring into logs from day one:

- **`Factuarea-Version`** — the contract version the response was rendered
  against. Pinning it is what makes an upgrade a deliberate act.
  → `factuarea-upgrade`
- **`X-RateLimit-Limit` / `-Remaining` / `-Reset`** — present on every response.
  A `429` additionally carries **`Retry-After`**, in seconds; honour it rather
  than backing off blindly. → `factuarea-audit` (`FCT-RATE-*`)

Errors always arrive in the same envelope, whatever went wrong:

```json
{
  "error": {
    "type": "https://docs.factuarea.com/errors/<code>",
    "code": "<stable machine code>",
    "message": "human, localised — do not branch on this",
    "doc_url": "https://docs.factuarea.com/guides/errors#<code>",
    "request_id": "req_..."
  }
}
```

A `422` also carries `error.errors[]`, one item per failing field — surface all
of them, not just the first.

## Recipes

Each of these is a starting shape. Follow the arrow: that skill has the code.

**"I want to issue invoices from my app."** Pick the SDK for the stack —
`@factuarea/sdk` (Node 20+) or `factuarea/factuarea-php` (PHP 8.2+) — read the
key from the environment, create against sandbox, then send. → **`factuarea-implement`**

**"I need to know when an invoice gets paid."** Register a webhook endpoint,
then build the receiver: verify the HMAC over the raw body, dedupe by
`Factuarea-Event-Id`, answer 2xx fast and do the work afterwards. Test the loop
locally with `factuarea listen --forward-to http://localhost:3000/webhooks` and
`factuarea trigger invoice.paid` (sandbox only). → **`factuarea-webhooks`**

**"Is this integration ready for production?"** Six rule families — webhook
signature, idempotency, key exposure, error handling, rate limits, document
lifecycle — each finding with a severity, a `file:line` and the fix.
→ **`factuarea-audit`**

**"Something changed on your side"** — a deprecation notice, an SDK bump, a
`Factuarea-Version` you want to move forward, a call that started failing. Diff
the code against the live spec and the published SDK release, classify every
difference as breaking or additive, apply breaking first. → **`factuarea-upgrade`**

**"What do the docs say about X?"** Stay here: `factuarea docs grep "X"` to find
the sections, `factuarea docs get <path>` to read one whole. Quote what it says;
do not fill gaps from memory.

**"Can you just create the invoice for me?"** That is not an integration task —
it is operating an account, and it belongs to the other plugin. See below.

## Which plugin the user actually needs

This plugin (`factuarea-api`) is for **writing code**. It declares no MCP
server, so it costs nothing at startup and needs no OAuth: the four specialised
skills work from the SDKs, the live spec and the published docs.

If what the user wants is Claude **acting on their real account** — listing this
quarter's unpaid invoices, creating a draft for a client, checking the VeriFactu
chain, registering a webhook endpoint — that is the **`factuarea-mcp`** plugin,
which connects to `https://mcp.factuarea.com` over OAuth or an API key and
exposes the API as tools. Point them at it:

```text
/plugin install factuarea-mcp@factuarea
```

The two are **complementary**, not alternatives. A team building an integration
typically installs both: this one to write the code, that one to inspect the
account the code is writing to.

## Documentation (source of truth)

- Docs home: <https://docs.factuarea.com>
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json>
- Guides: [pagination](https://docs.factuarea.com/guides/pagination) ·
  [idempotency](https://docs.factuarea.com/guides/idempotency) ·
  [errors](https://docs.factuarea.com/guides/errors) ·
  [webhooks](https://docs.factuarea.com/guides/webhooks) ·
  [versioning](https://docs.factuarea.com/guides/versioning)
- SDKs: <https://docs.factuarea.com/sdks>
- CLI: <https://docs.factuarea.com/cli>
- API keys: <https://app.factuarea.com/settings/developers/api-keys>
- Support: <https://docs.factuarea.com/support> · beta access: `info@factuarea.com`
