---
name: factuarea-mcp
description: Operate the Factuarea MCP server — invoicing, quotes, pro-formas, delivery notes, recurring & purchase invoices, sales orders, purchase orders and goods receipts, warehouses with stock transfers and reservations, fulfilment and carriers, returns, storefront credentials, clients, suppliers, contacts, products, price lists, document series, taxes, VeriFactu (AEAT) and webhooks for Spanish companies. Use this when the user has the Factuarea MCP connected (or wants to connect it) and asks Claude to read or act on their accounting, order or stock data — search/create/send invoices, confirm a sales order, move stock between warehouses, ship a delivery, manage clients, check VeriFactu, configure webhooks — and to interpret scopes, cursor pagination, the error envelope, and test (sandbox) mode.
---

# Factuarea MCP server

Factuarea is a multi-tenant invoicing and ERP SaaS for Spanish businesses. This
plugin connects Claude Code to the **Factuarea MCP server** at
`https://mcp.factuarea.com` (HTTP transport), exposing the Factuarea public API
as MCP tools. Every tool is bound to one company and one environment, and is
gated by OAuth scopes, the company's subscription module, and feature flags.

> The canonical endpoint is the root `https://mcp.factuarea.com`; the older
> `https://mcp.factuarea.com/mcp` keeps working as a compatibility alias.

This skill is the context Claude needs to drive those tools correctly. It is a
summary — the **source of truth is the published docs** (links below). When you
need an exact tool argument, schema, or scope, read the docs; do not invent tool
names, fields or scopes.

## Connecting (two channels)

The server is the same; the difference is how you authenticate.

### Recommended: OAuth (no key handling)

The plugin declares the server **without an auth header**, so on first use the
server answers `401` and Claude Code starts the OAuth flow:

1. Run `/mcp`, pick **factuarea**, choose **Authenticate**.
2. A browser opens the Factuarea consent screen. Dynamic Client Registration
   (DCR) + PKCE happen automatically — no client id/secret to paste.
3. On the consent screen you **select the company and the environment**
   (live or test) and approve the requested scopes. Sensitive scopes (deletes,
   `invoices:void`) are shown with a warning and are **not** pre-checked.
4. Claude Code stores the token and refreshes it transparently.

This is the camino recomendado for end users: nothing secret is ever pasted into
a config file.

### Alternative: API key (the account owner's own key)

For headless setups or when the user already has a `fact_` key, connect with a
static header instead of OAuth:

```bash
claude mcp add --transport http factuarea https://mcp.factuarea.com \
  --header "Authorization: Bearer fact_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

Use a `fact_test_` key to point at the sandbox. The API surface is identical;
only the prefix changes the environment.

> If you connect with an API key header, you do **not** need the OAuth flow — the
> key authenticates every request directly.

## Channel policy — what tools you actually get

The catalog is the same set of tools, but the two channels resolve a **different
maximum reach**:

- **API key (owner's own key, scope `*`)** → the full catalog of **619 tools**.
  The owner is acting on their own company, so the key can cover everything,
  including the privileged operations below.
- **OAuth (third-party app, curated scopes)** → **518 tools**. The remaining
  **101** are unreachable by consent: the OAuth scope catalog has no dotted
  scope that translates to them, so a third-party app can never reach them on
  the user's behalf. They fall into five groups:
  - **Account and credential administration** — `account:write`, `api_keys:read`,
    `api_keys:write`, `companies:read`, `companies:write`, `companies:delete`,
    `developers:read`. Who holds the keys to the account is decided by the owner
    from their own dashboard or with their own key, never by a delegated app.
  - **VeriFactu writes** — `verifactu:write`: creating/retrying VeriFactu
    records, editing VeriFactu settings, and uploading/activating/revoking FNMT
    certificates. VeriFactu **reads** (`verifactu:read`) stay available.
  - **Connected stores and money movement** — `stores:read`, `stores:write`,
    `woocommerce_store:write`, `shopify_store:write`, `integration_events:read`,
    `integration_events:write`, `payouts:read`, `stripe_autoinvoicing:read`,
    `stripe_autoinvoicing:write`, `emails:read`.
  - **Workforce actions taken on someone's behalf** — `absences:write`,
    `absences:transition`, `time_entries:write`, `work_schedules:write`.
  - **Irreversible or credential-shaped operations** —
    `delivery_notes:gdpr_forget` (forgetting a delivery-note signature audit
    trail), `automations:delete`, and the two ERP entries:
    `warehouses:delete` (dropping a warehouse that still has stock and movements
    behind it) and `storefront_keys:read` / `storefront_keys:write` /
    `storefront_keys:delete` (managing the publishable storefront credential —
    same rule as `api_keys:*`).

  Everything else in the ERP surface **is** reachable by OAuth: of the 141 ERP
  tools, 132 are consent-reachable and only those 9 are not. The buyer-lane
  scopes `storefront:read` / `storefront:write` are not in this list because no
  MCP tool declares them at all — that lane is the anonymous shopper's browser
  key, not an agent channel.

Beyond the channel, the tools you see in `tools/list` are further narrowed by:

- the **scopes** actually granted (a tool whose `RequiredScope` you lack is
  hidden, and invoking it returns `insufficient_scope`);
- the company's **subscription plan / module** (e.g. `warehouses:*`,
  `stock_transfers:*`, `fulfilment:*` and `returns:*` need their ERP module,
  plan empresario+; `sales_orders:*` is available from emprendedor); and
- **feature flags**.

So an OAuth session with read-only scopes on an emprendedor plan will list far
fewer than 518 tools — that's expected, not an error.

## Tool domains (37)

Tools are named `<verb>_<noun>` (e.g. `search_invoices`, `create_client`,
`mark_invoice_as_paid`). The catalog covers 37 domains and **619** tools.
**Tools** is what an API key with scope `*` sees; **OAuth** is what a consent
grant can reach (`all` when the whole domain is reachable). Rows marked ✦ are
the ERP surface — orders, stock and fulfilment.

| Domain | Tools | OAuth | Scopes |
| --- | ---: | ---: | --- |
| Invoices | 44 | all | `invoices:delete` · `invoices:read` · `invoices:send` · `invoices:void` · `invoices:write` · `pdfs:read` |
| Products | 39 | all | `products:delete` · `products:read` · `products:write` |
| Purchase orders & goods receipts ✦ | 38 | all | `goods_receipts:read` · `goods_receipts:transition` · `goods_receipts:write` · `pdfs:read` · `purchase_orders:delete` · `purchase_orders:read` · `purchase_orders:send` · `purchase_orders:transition` · `purchase_orders:write` |
| Warehouses, stock transfers & reservations ✦ | 37 | 35 | `pdfs:read` · `products:read` · `stock_reservations:read` · `stock_reservations:write` · `stock_transfers:read` · `stock_transfers:transition` · `stock_transfers:write` · `warehouses:read` · `warehouses:write` · `warehouses:delete` *(API key only)* |
| Time tracking | 29 | 17 | `payroll_exports:read` · `time_entries:read` · `time_entries:write` *(API key only)* |
| VeriFactu | 27 | 19 | `verifactu:read` · `verifactu:write` *(API key only)* |
| Sales orders ✦ | 26 | all | `pdfs:read` · `sales_orders:delete` · `sales_orders:read` · `sales_orders:send` · `sales_orders:transition` · `sales_orders:write` |
| Absences | 25 | 10 | `absences:read` · `absences:transition` · `absences:write` *(API key only)* |
| Connected stores & integrations | 22 | 0 | `integration_events:read` · `integration_events:write` · `payouts:read` · `shopify_store:write` · `stores:read` · `stores:write` · `stripe_autoinvoicing:read` · `stripe_autoinvoicing:write` · `woocommerce_store:write` *(API key only)* |
| Delivery notes | 22 | 21 | `delivery_notes:delete` · `delivery_notes:read` · `delivery_notes:transition` · `delivery_notes:write` · `pdfs:read` · `delivery_notes:gdpr_forget` *(API key only)* |
| Fulfilment & carriers ✦ | 21 | all | `carriers:delete` · `carriers:read` · `carriers:write` · `fulfilment:read` · `fulfilment:transition` · `fulfilment:write` · `pdfs:read` |
| Pro-formas | 20 | all | `pdfs:read` · `proformas:delete` · `proformas:read` · `proformas:send` · `proformas:transition` · `proformas:write` |
| Quotes | 20 | all | `pdfs:read` · `quotes:delete` · `quotes:read` · `quotes:send` · `quotes:transition` · `quotes:write` |
| Automations | 18 | 17 | `automation_runs:read` · `automations:read` · `automations:write` · `automations:delete` *(API key only)* |
| Contacts | 18 | all | `contacts:delete` · `contacts:read` · `contacts:write` |
| Managed companies (gestoría) | 18 | 0 | `api_keys:read` · `api_keys:write` · `companies:delete` · `companies:read` · `companies:write` *(API key only)* |
| Purchase invoices | 18 | all | `pdfs:read` · `purchase_invoices:delete` · `purchase_invoices:read` · `purchase_invoices:transition` · `purchase_invoices:write` |
| Recurring invoices | 17 | all | `recurring_invoices:delete` · `recurring_invoices:read` · `recurring_invoices:transition` · `recurring_invoices:write` |
| Taxes | 16 | all | `taxes:read` · `taxes:write` |
| Clients | 13 | all | `clients:delete` · `clients:read` · `clients:write` |
| Price lists | 13 | all | `price_lists:read` · `price_lists:write` |
| Webhooks & events | 13 | all | `events:read` · `webhooks:delete` · `webhooks:read` · `webhooks:write` |
| Employees | 12 | all | `employees:read` · `employees:write` |
| Returns ✦ | 12 | all | `returns:read` · `returns:transition` · `returns:write` |
| Series | 12 | all | `series:read` · `series:write` |
| Suppliers | 12 | all | `suppliers:delete` · `suppliers:read` · `suppliers:write` |
| Work schedules | 11 | 5 | `work_schedules:read` · `work_schedules:write` *(API key only)* |
| Tax reports | 9 | all | `tax_reports:read` · `tax_reports:write` |
| Storefront credentials ✦ | 7 | 0 | `storefront_keys:delete` · `storefront_keys:read` · `storefront_keys:write` *(API key only)* |
| API keys | 5 | 2 | `account:read` · `account:write` *(API key only)* |
| Employee seats | 5 | all | `employees:read` · `employees:write` |
| FacturaE | 5 | all | `facturae:read` · `facturae:write` |
| Company account | 4 | 3 | `account:read` · `account:write` *(API key only)* |
| Emails | 3 | 0 | `emails:read` *(API key only)* |
| Holidays | 3 | all | `holidays:read` |
| Presence | 3 | all | `presence:read` |
| Developer settings | 2 | 0 | `developers:read` *(API key only)* |

Counts and scopes are taken from the published surface statistics of the
contract (`public-api-stats.json`, measured 2026-09-18) and from the closed
scope catalog; they are not hand-maintained lists.

PDF downloads and payment receipts use the transversal `pdfs:read` scope;
activity/event logs use `events:read`.

State changes are **discrete tools**, not a generic `change_status`: e.g.
`mark_invoice_as_paid`, `send_invoice`, `void_invoice`, `accept_quote`,
`convert_quote`, `sign_delivery_note`, `pause_recurring_invoice`. Pick the tool
that names the transition.

## Identity & data shapes

- **IDs** are opaque `id` strings (**UUID v7**), not integers. Foreign keys are
  exposed as `*_id` and also carry UUID v7 values. Receive them and send them
  back as-is; never parse or generate them. On create, do not pass an `id` —
  the server generates and returns it.
- **Cursor pagination** on list/search tools: pass `limit` and `starting_after`
  (the last item's `id`), and read back:

  ```json
  { "data": [ /* ... */ ], "has_more": true, "next_cursor": "<id>" }
  ```

  Loop while `has_more` is `true`, passing `next_cursor` (or the last `id`) as
  `starting_after`. There are no page numbers.
- **Amounts** are EUR unless stated; **dates** are `YYYY-MM-DD`.
- **File uploads** (product media, purchase-invoice attachments, FNMT
  certificates) travel as **base64 strings** in the tool arguments — the
  MCP transport has no multipart. The server decodes, validates size and magic
  bytes, then processes. Downloads come back as base64 too.

## Errors you'll see

Tool failures map to the same envelope as the REST API; branch on the **code**,
not the human message (messages are in Spanish):

- `insufficient_scope` (`403`) — the token/key lacks the tool's `RequiredScope`.
  The fix is to re-authenticate (`/mcp` → Authenticate) and approve the scope,
  or use a key that has it. Remember the five groups above — `verifactu:write`,
  account/credential administration, connected stores, workforce actions and the
  irreversible operations (including `warehouses:delete` and
  `storefront_keys:*`) — are **API-key only**: no amount of re-consenting will
  grant them.
- `addon_not_active` / module-not-available — the tool's module isn't in the
  company's plan (e.g. the warehouses or fulfilment module on emprendedor). Not
  a bug; the plan must include it.
- **`422`** — validation or **business-rule violation** (invalid status
  transition, document not in an editable state, payment date out of range).
  Business-rule violations are `422`, not `403`/`409`.
- **`409`** — duplicate creation, idempotency-key reuse with a different body,
  or a concurrency lock. Reuse the same idempotency key only for true retries.
- **`429`** — throttled. Honour the `Retry-After` header: wait that many seconds
  before retrying; don't hammer.
- `401` — not authenticated (kicks off OAuth) or an invalid/expired key.

## Test mode (sandbox)

Always build and rehearse in **test mode** first:

- Authenticate via OAuth and pick the **Test** environment, or connect with a
  `fact_test_` key.
- A `fact_test_` key (or test OAuth grant) targets an **isolated sandbox
  company**. External effects are **switched off**: no VeriFactu submission to
  AEAT, no emails to clients, no outbound webhooks. The API surface is identical
  to live, so you can exercise create/send/convert flows safely.
- The **prefix is the source of truth** for the environment — there is no request
  parameter that flips it.

## Documentation (source of truth)

- MCP overview: <https://docs.factuarea.com/mcp>
- Connect: <https://docs.factuarea.com/mcp/connect>
- Authentication (OAuth + API keys): <https://docs.factuarea.com/mcp/authentication>
- Tools catalog: <https://docs.factuarea.com/mcp/tools>
- Scopes: <https://docs.factuarea.com/mcp/scopes>
- Errors: <https://docs.factuarea.com/mcp/errors>
- Test mode: <https://docs.factuarea.com/mcp/test-mode>
- Docs home: <https://docs.factuarea.com> · OpenAPI: <https://docs.factuarea.com/api/openapi>
- Dashboard / API keys: <https://app.factuarea.com/settings/developers/api-keys>

The Factuarea public API is in **private beta** — companies must be allowlisted
before keys or OAuth grants work. Request access at `info@factuarea.com`.

## Typical workflow

1. **Read before you write.** Use `search_*` to find documents and `get_*` for
   full detail before mutating. To bill a client, first `search_clients` and
   `search_products` (or `find_client_by_tax_id`), then `create_invoice`.
2. **Stay in the sandbox** until the flow is correct.
3. **Use the discrete transition tool** for state changes, and surface the
   Spanish `message` (or map by `code`) when a tool returns an error.
4. **Page with the cursor** (`has_more` / `next_cursor`), never with page numbers.
