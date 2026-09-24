---
name: factuarea-mcp
description: Operate the Factuarea MCP server — invoicing, quotes, pro-formas, delivery notes, recurring & purchase invoices, contacts (customers and suppliers), products, price lists, document series, taxes, VeriFactu (AEAT), FacturaE, tax reports, time tracking, automations and webhooks for Spanish companies. Use this when the user has the Factuarea MCP connected (or wants to connect it) and asks Claude to read or act on their business data — search/create/send invoices, manage contacts, check VeriFactu, configure webhooks — and to interpret scopes, cursor pagination, the error envelope, and test (sandbox) mode.
---

# Factuarea MCP server

Factuarea is a multi-tenant invoicing SaaS for Spanish businesses. This plugin
connects Claude Code to the **Factuarea MCP server** at
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

- **API key (owner's own key, scope `*`)** → the **full catalog**. The owner is
  acting on their own company, so the key can cover everything, including the
  owner-only operations below.
- **OAuth (third-party app, curated scopes)** → a **curated subset**. The OAuth
  scope catalog deliberately **never grants** these groups, so a third-party app
  can never reach them on the user's behalf:
  - **VeriFactu writes** (`verifactu:write`) — registering/retrying records and
    events, VeriFactu settings, uploading/activating/revoking FNMT certificates.
  - **GDPR erasure** of the delivery-note signature audit trail
    (`delivery_notes:gdpr_forget`).
  - **Payments, gateways and stores** (`stripe_autoinvoicing:*`, `payouts:read`,
    `integration_events:*`, `stores:*`, `woocommerce_store:write`,
    `shopify_store:write`).
  - **Emails and API request logs** (`emails:read`, `developers:read`).
  - **Managed companies and their API keys** (`companies:*`, `api_keys:*`) and
    **account writes** (`account:write`).
  - **Privileged workforce writes** (`time_entries:write`, `absences:write`,
    `absences:transition`, `work_schedules:write`).
  VeriFactu **reads** (`verifactu:read`) and workforce reads remain available to
  OAuth apps. Live counts per channel and domain:
  <https://docs.factuarea.com/mcp/tools>.

Beyond the channel, the tools you see in `tools/list` are further narrowed by:

- the **scopes** actually granted (a tool whose `RequiredScope` you lack is
  hidden, and invoking it returns `insufficient_scope`);
- the company's **subscription plan / module**; and
- **feature flags**.

So an OAuth session with read-only scopes on a small plan will list far fewer
tools than the full catalog — that's expected, not an error.

## Tool domains (29)

Tools are named `<verb>_<noun>` (e.g. `search_invoices`, `create_contact`,
`mark_invoice_as_paid`). The catalog covers 29 domains; † marks owner-only
(API key) scopes:

| Domain | Scopes |
| --- | --- |
| Invoices | `invoices:read` · `invoices:write` · `invoices:send` · `invoices:void` · `invoices:delete` |
| Contacts (customers and suppliers) | `contacts:read` · `contacts:write` · `contacts:delete` |
| Products | `products:read` · `products:write` · `products:delete` |
| Price lists | `price_lists:read` · `price_lists:write` |
| Quotes | `quotes:read` · `quotes:write` · `quotes:send` · `quotes:transition` · `quotes:delete` |
| Pro-forma invoices | `proformas:read` · `proformas:write` · `proformas:send` · `proformas:transition` · `proformas:delete` |
| Delivery notes | `delivery_notes:read` · `delivery_notes:write` · `delivery_notes:transition` · `delivery_notes:delete` · `delivery_notes:gdpr_forget` † |
| Purchase invoices | `purchase_invoices:read` · `purchase_invoices:write` · `purchase_invoices:transition` · `purchase_invoices:delete` |
| Recurring invoices | `recurring_invoices:read` · `recurring_invoices:write` · `recurring_invoices:transition` · `recurring_invoices:delete` |
| Series | `series:read` · `series:write` (series are immutable: archive, never delete) |
| Taxes | `taxes:read` · `taxes:write` |
| VeriFactu | `verifactu:read` · `verifactu:write` † |
| FacturaE (FACe) | `facturae:read` · `facturae:write` |
| Tax reports (Modelo 303, 347, 130) | `tax_reports:read` · `tax_reports:write` |
| Webhooks & events | `webhooks:read` · `webhooks:write` · `webhooks:delete` · `events:read` |
| Automations | `automations:read` · `automations:write` · `automations:delete` · `automation_runs:read` |
| Account | `account:read` · `account:write` † |
| API keys | `account:read` · `account:write` † |
| Managed companies (gestoría) | `companies:*` † · `api_keys:*` † |
| Payments & gateways | `stripe_autoinvoicing:*` † · `payouts:read` † · `integration_events:*` † · `stores:*` † · `woocommerce_store:write` † · `shopify_store:write` † |
| Emails | `emails:read` † |
| API request logs | `developers:read` † |
| Employees | `employees:read` · `employees:write` |
| Employee seats | `employees:read` · `employees:write` |
| Work schedules | `work_schedules:read` · `work_schedules:write` † |
| Time tracking | `time_entries:read` · `time_entries:write` † · `payroll_exports:read` |
| Absences | `absences:read` · `absences:write` † · `absences:transition` † |
| Presence | `presence:read` |
| Holidays | `holidays:read` |

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
- **File uploads** (product media, purchase-invoice attachments,
  FNMT certificates) travel as **base64 strings** in the tool arguments — the
  MCP transport has no multipart. The server decodes, validates size and magic
  bytes, then processes. Downloads come back as base64 too.

## Errors you'll see

Tool failures map to the same envelope as the REST API; branch on the **code**,
not the human message (messages are in Spanish):

- `insufficient_scope` (`403`) — the token/key lacks the tool's `RequiredScope`.
  The fix is to re-authenticate (`/mcp` → Authenticate) and approve the scope,
  or use a key that has it. Remember that the owner-only groups listed under
  *Channel policy* are **API-key only**.
- `addon_not_active` / module-not-available — the tool's module isn't in the
  company's plan. Not a bug; the plan must include that module.
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

The public API and the MCP server are **included in every Factuarea plan**,
trial included. Create keys in the dashboard or connect over OAuth.

## Typical workflow

1. **Read before you write.** Use `search_*` to find documents and `get_*` for
   full detail before mutating. To bill a customer, first `search_contacts` and
   `search_products` (or `find_contact_by_tax_id`), then `create_invoice`.
2. **Stay in the sandbox** until the flow is correct.
3. **Use the discrete transition tool** for state changes, and surface the
   Spanish `message` (or map by `code`) when a tool returns an error.
4. **Page with the cursor** (`has_more` / `next_cursor`), never with page numbers.
