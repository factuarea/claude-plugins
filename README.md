# Factuarea — Claude Code plugins

Official [Claude Code](https://claude.com/claude-code) plugin marketplace for
**[Factuarea](https://factuarea.com)** — the multi-tenant invoicing SaaS for
Spanish businesses (invoicing, quotes, contacts — customers and suppliers are
roles of one contact — products, VeriFactu and webhooks).

## Two plugins, two jobs

| Plugin | For | What it does |
| --- | --- | --- |
| [`factuarea-mcp`](./plugins/factuarea-mcp) | **Running your business** | Connects Claude Code to the **Factuarea MCP server** (`https://mcp.factuarea.com`) so Claude can call Factuarea tools directly — search/create/send invoices, manage contacts, issue transport control documents (DeCA), follow tasks and projects, check VeriFactu, configure webhooks. Authenticate via OAuth or an API-key header. One skill, on using those tools well |
| [`factuarea-api`](./plugins/factuarea-api) | **Building the integration** | Five developer skills for the code you write in your own repository: where to start, the official TypeScript and PHP SDKs, webhook receivers, auditing an existing integration, and realigning it after a contract or SDK change. **Declares no MCP server** |

They are **complementary, not alternatives**.

- Install **`factuarea-mcp`** when you want Claude to *act on a real account*.
  It brings the MCP server, so it costs an OAuth consent (or an API key) and
  loads the tool surface into the session.
- Install **`factuarea-api`** when you want Claude to *write integration code*.
  It is deliberately lightweight — no server declaration, no OAuth, nothing
  loaded at startup. None of its five skills needs the MCP server connected;
  they work from the official SDKs, the live OpenAPI spec and the published
  docs.
- Install **both** if you do both: write the integration with one, and inspect
  the account it writes to with the other.

## Install

In Claude Code, register the catalog once:

```text
/plugin marketplace add factuarea/claude-plugins
```

Then install whichever you need:

```text
/plugin install factuarea-mcp@factuarea     # operate the account
/plugin install factuarea-api@factuarea     # build the integration
```

To update later, run `/plugin marketplace update factuarea`.

## `factuarea-mcp` — operate the account

The plugin declares the server **without an auth header**, so the recommended
path is OAuth:

1. Run `/mcp`, pick **factuarea**, choose **Authenticate**.
2. Approve in the browser — Dynamic Client Registration + PKCE are automatic. On
   the consent screen you **select the company and the environment** (live or
   test) and the scopes to grant.

Prefer your own API key? Connect with a static header instead:

```bash
claude mcp add --transport http factuarea https://mcp.factuarea.com \
  --header "Authorization: Bearer fact_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

Use a `fact_test_` key for the isolated sandbox (external effects off). The
canonical endpoint is the root `https://mcp.factuarea.com`; the older
`https://mcp.factuarea.com/mcp` keeps working as a compatibility alias.

Its skill covers:

- **Connecting** via OAuth (consent with company + environment selection) or an
  API-key header.
- **Channel policy** — an API key reaches the whole catalog; OAuth uses a
  curated subset and never grants the owner-only operations (VeriFactu writes,
  GDPR erasure, payments and stores, managed companies, API keys, privileged
  workforce writes) to third-party apps. Live counts per domain:
  [MCP tools](https://docs.factuarea.com/mcp/tools).
- **Tool domains** and their scopes, plus how plan/module and feature flags
  further narrow what's listed.
- **Identity** — opaque `id` (UUID v7), foreign keys as `*_id`.
- **Cursor pagination** — `{ data, has_more, next_cursor }`, no page numbers
  (the template, brand and presentation-history lists are offset lists with
  `page` / `per_page`).
- **Errors** — a failure inside a tool is a result with `isError: true` whose
  `_meta["com.factuarea/error"]` carries the REST error contract (`code`,
  `http_status`, `hint`, …); the checks that run before the tool answer a
  JSON-RPC error with the same `code`. Then `insufficient_scope`,
  `module_not_in_plan`, `422` business-rule violations and `429` with
  `Retry-After`.
- **Test mode** — the `fact_test_` prefix / test OAuth grant points at an
  isolated sandbox with external effects switched off.

## `factuarea-api` — build the integration

| Skill | Activates when you're… |
| --- | --- |
| `factuarea-api` | Starting out, or asking what the API supports, how auth works, or what the docs say about something. The entry point — it routes to the other four |
| `factuarea-implement` | Writing application code that calls the API with the official TypeScript or PHP SDK |
| `factuarea-webhooks` | Building the endpoint that receives webhook deliveries — signature verification, dedup, acknowledgement |
| `factuarea-audit` | Reviewing an integration that is already written, against the contract's rules |
| `factuarea-upgrade` | Realigning code after a spec change or an SDK bump |

### `factuarea-api` — where to start

- **Fourteen golden rules**, each pointing at the skill that goes deep on it.
- **Documentation lookup that stays on the machine** — `factuarea docs
  list|grep|get` downloads the published corpus once, caches it for 15 minutes
  and filters **locally**: no API key, and the search term never leaves the
  machine. Plus `factuarea docs search` over the OpenAPI spec embedded in the
  binary, which never touches the network at all.
- **Authentication and environments** — the two accepted headers and which wins,
  what the `fact_test_` sandbox switches off, the `Factuarea-Version` and
  `X-RateLimit-*` response headers, and the shape of the error envelope.
- **Recipes** that route to the right skill.

### `factuarea-implement` — building the integration

- **Choosing the SDK** — `@factuarea/sdk` (Node 20+) or `factuarea/factuarea-php`
  (PHP 8.2+), and what you take on by hand-rolling HTTP instead.
- **Contract invariants** — opaque UUID v7 `id`s, the `data` envelope, cursor
  pagination (`has_more` / `next_cursor`; only the template, brand and
  presentation-history lists use `page` / `per_page`), `Idempotency-Key`
  on writes, and the key prefix as the only environment switch.
- **Server-side only** — why there is no browser-safe key, and sandbox first.
- **Conditional writes and PDFs** — `If-Match`, `If-None-Match`, `202`/`304`, no-retry
  FACe submissions and omitted vs `null`, with the real SDK and CLI options. The
  PHP SDK's typed methods for the new operations are not generated yet: the recipe
  uses `RawRequest`, `RequestOverrides`, `ResponseMeta` and `NoRetry`.

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

- **Seven rule families** — webhook signature, idempotency, API-key exposure, error
  handling by `code`, rate limits, document lifecycle, conditional writes and PDF
  downloads.
- **A CE01 to CE25 checklist** for the client flows of the PDF template contract,
  each with its own severity; flows the integration does not use are "not used".
- **Findings with a severity, a `file:line` and a concrete fix** — and explicit
  exemptions per rule, so code that already does the right thing isn't flagged.

### `factuarea-upgrade` — after a contract or SDK change

- **Drift detection** against the live spec and the published SDK versions.
- **Breaking vs additive** by the published versioning policy, including how a
  dated `Factuarea-Version` pin changes the answer.
- **An ordered plan** — breaking first, verified in the sandbox, with a checklist
  for the PDF template, presentation and business-data contract.

## Resources

- MCP docs: <https://docs.factuarea.com/mcp> — connect · authentication · tools ·
  scopes · errors · test-mode
- MCP server repository (npm package, registry manifest, issues):
  <https://github.com/factuarea/factuarea-mcp>
- Docs home: <https://docs.factuarea.com>
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json> — **root route**: it describes the whole v1 surface, so it takes no `/companies/{company}` segment
- SDKs: <https://docs.factuarea.com/sdks> —
  [TypeScript](https://docs.factuarea.com/sdks/typescript) ·
  [PHP](https://docs.factuarea.com/sdks/php)
- CLI: <https://docs.factuarea.com/cli>
- Dashboard / API keys: <https://app.factuarea.com/settings/developers/api-keys>
- Support: <https://docs.factuarea.com/support> · contact: `info@factuarea.com`

## Validate the skills

```bash
python3 scripts/validate_plugins.py                      # manifests and skill frontmatter (CI)
python3 scripts/test_document_template_contracts.py \
  --spec <openapi.json> --mcp-catalog <mcp-catalog.json> \
  --error-catalog <error-catalog.json> \
  [--stats <stats.json> --mcp-tools <mcp-tools.json>] [--php-src <factuarea-php>/src]
```

The second script needs no dependency and no network. It fails when a skill or
README cites an `operationId`, a `METHOD /path`, a scope, an error code (or a
known code with a status the catalog does not give it), an MCP tool, a contract
header or (with `--php-src`) a PHP SDK method or helper that the files you pass
do not contain, when a company resource is cited without its
`/companies/{company}` segment, and when `factuarea-audit` does not list exactly
the client flows CE01 to CE25. With `--stats` and `--mcp-tools` it also checks
every tool and domain count and every row of the MCP domain table against the
measured catalog. The input files (the OpenAPI document is about 24 MB) are
deliberately **not** copied into this repository: pass the ones that match the
contract you are documenting, so a copy cannot drift from the source. It is a
local check; CI runs only `validate_plugins.py`.

## Releasing

There is nothing to publish. This marketplace is installed straight from the Git
repository (`/plugin marketplace add factuarea/claude-plugins`), so a change is
live for users as soon as it lands on the default branch. The repository carries
**no package on any registry** — no npm, no Packagist, no wordpress.org — and
**no release workflow**: don't look for a publish step after merging a pull
request, and don't tag. Bump the `version` field in
`.claude-plugin/marketplace.json` and in the affected `plugins/*/.claude-plugin/plugin.json`
when a plugin's contents change, and keep the two in sync. The bump belongs to the
merge that makes the change live, not to every edit on the way there: a branch may
carry several edits to the same plugin and still bump its version once.

## License

[MIT](./LICENSE)
