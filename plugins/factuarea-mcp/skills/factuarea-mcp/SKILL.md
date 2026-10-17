---
name: factuarea-mcp
description: Operate the Factuarea MCP server — invoicing, quotes, pro-formas, delivery notes, transport control documents (DeCA), recurring & purchase invoices, contacts (customers and suppliers are roles of one contact), products, price lists, document series, taxes, VeriFactu (AEAT), tasks and projects, and webhooks for Spanish companies. Use this when the user has the Factuarea MCP connected (or wants to connect it) and asks Claude to read or act on their accounting data — search/create/send invoices, manage contacts, issue the DeCA for a road freight transport, follow tasks and projects, check VeriFactu, configure webhooks — and to interpret scopes, cursor pagination, the error envelope, and test (sandbox) mode.
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

- **API key (owner's own key, scope `*`)** → the whole catalog a `*` holder
  sees, **613 tools**. The owner is acting on their own account, so the key can
  cover everything, including the privileged operations below. The managed-account
  tools (provisioning, plan changes, ending a management) are
  **not** in that figure: they need the privileged scope `accounts:read` /
  `accounts:write`, which `*` does **not** cover, so they only appear for a key
  that carries `accounts:*`, granted by a superadmin. OAuth never grants it.
- **OAuth (third-party app, curated scopes)** → **489 tools**. The remaining
  **124** are unreachable by consent: the OAuth scope catalog has no dotted
  scope that translates to them, so a third-party app can never reach them on
  the user's behalf. They fall into five groups:
  - **Account and credential administration** — `account:write`,
    `companies:read`, `companies:write`, `companies:delete`, `developers:read`,
    plus the privileged `accounts:read` / `accounts:write`. Who holds the keys
    to the account and which NIFs it has is decided by the owner from their own dashboard or with their own key,
    never by a delegated app.
    Account webhooks (`webhooks:*` at account level) and account request logs
    (`developers:read`) are the same: **API key only**.
    Bulk import of managed accounts has **no MCP tool**, by design (it is
    privileged and uploads a file, which the MCP transport does not carry): use
    the REST API.
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
    trail), `automations:delete` and the deletion of tasks and projects
    (`tasks:delete`, `projects:delete`), which takes comments, attachments and
    logged time with it.
  OAuth apps do reach the reading and writing of tasks and projects (the writes
  are shown with a warning and not pre-checked), the member directory
  (`users:read`) and the user's own notifications.

Beyond the channel, the tools you see in `tools/list` are further narrowed by:

- the **scopes** actually granted (a tool whose `RequiredScope` you lack is
  hidden, and invoking it returns `insufficient_scope`);
- the company's **subscription plan / module**; and
- **feature flags**.

## Product terminology and stable contracts

The product calls purchases **Expenses** (ES: Gastos; CA: Despeses) and sales
**Invoices** (ES: Facturas; CA: Factures). Recognize the former names “purchase
invoices” and “sales invoices” in user requests, but use the current names in
responses. A supplier invoice is still a fiscal supporting document for an expense.
Resource names such as `purchase_invoices`, scopes, event IDs, tool names, SDK
methods and routes stay unchanged. Never invent an `expenses` resource or rename
a tool to match a display label.

So an OAuth session with read-only scopes on an Esencial (`emprendedor`) plan will list far
fewer than 489 tools — that's expected, not an error.

## Tool domains (39)

Tools are named `<verb>_<noun>` (e.g. `search_invoices`, `create_contact`,
`mark_invoice_as_paid`). **Tools** is what an API key with scope `*` sees;
**OAuth** is what a consent grant can reach (`all` when the whole domain is
reachable).

The catalog is **613 tools** across **39 domains**, of which **489** are
reachable by an OAuth consent grant and **124** are API-key only. Privileged
`accounts:*` tools (managed accounts) are outside these figures: only a
credential with that scope sees them.

| Domain | Tools | OAuth | Scopes |
| --- | ---: | ---: | --- |
| Tasks | 52 | 46 | `tasks:delete` *(API key only)* · `tasks:read` · `tasks:write` |
| Invoices | 45 | all | `invoices:delete` · `invoices:read` · `invoices:send` · `invoices:void` · `invoices:write` · `pdfs:read` |
| Products | 40 | all | `products:delete` · `products:read` · `products:write` |
| VeriFactu | 31 | 20 | `verifactu:read` · `verifactu:write` *(API key only)* |
| Time tracking | 29 | 17 | `payroll_exports:read` · `time_entries:read` · `time_entries:write` *(API key only)* |
| Contacts | 28 | all | `contacts:delete` · `contacts:read` · `contacts:write` |
| Connected stores & integrations | 26 | 0 | `integration_events:read` *(API key only)* · `integration_events:write` *(API key only)* · `payouts:read` *(API key only)* · `shopify_store:write` *(API key only)* · `stores:read` *(API key only)* · `stores:write` *(API key only)* · `stripe_autoinvoicing:read` *(API key only)* · `stripe_autoinvoicing:write` *(API key only)* · `woocommerce_store:write` *(API key only)* |
| Absences | 25 | 10 | `absences:read` · `absences:transition` *(API key only)* · `absences:write` *(API key only)* |
| Delivery notes | 22 | 21 | `delivery_notes:delete` · `delivery_notes:gdpr_forget` *(API key only)* · `delivery_notes:read` · `delivery_notes:transition` · `delivery_notes:write` · `pdfs:read` |
| Projects | 22 | 19 | `projects:delete` *(API key only)* · `projects:read` · `projects:write` · `invoices:write` |
| Pro-formas | 20 | all | `pdfs:read` · `proformas:delete` · `proformas:read` · `proformas:send` · `proformas:transition` · `proformas:write` |
| Quotes | 20 | all | `pdfs:read` · `quotes:delete` · `quotes:read` · `quotes:send` · `quotes:transition` · `quotes:write` |
| Purchase invoices | 19 | all | `pdfs:read` · `purchase_invoices:delete` · `purchase_invoices:read` · `purchase_invoices:transition` · `purchase_invoices:write` |
| Automations | 18 | 17 | `automation_runs:read` · `automations:delete` *(API key only)* · `automations:read` · `automations:write` |
| Employees | 18 | all | `employees:read` · `employees:write` |
| Recurring invoices | 18 | all | `recurring_invoices:delete` · `recurring_invoices:read` · `recurring_invoices:transition` · `recurring_invoices:write` |
| Taxes | 18 | all | `taxes:delete` · `taxes:read` · `taxes:write` |
| Account NIFs & usage | 15 | 1 | `account:read` · `companies:delete` *(API key only)* · `companies:read` *(API key only)* · `companies:write` *(API key only)* |
| Transport control documents (DeCA) | 15 | all | `pdfs:read` · `transport_documents:delete` · `transport_documents:read` · `transport_documents:transition` · `transport_documents:write` |
| Price lists | 13 | all | `price_lists:read` · `price_lists:write` |
| Series | 13 | all | `series:read` · `series:write` |
| Webhooks & events | 13 | all | `events:read` · `webhooks:delete` · `webhooks:read` · `webhooks:write` |
| Employee seats | 11 | all | `employees:read` · `employees:write` |
| Work schedules | 11 | 5 | `work_schedules:read` · `work_schedules:write` *(API key only)* |
| Account webhooks | 10 | 0 | `webhooks:delete` *(API key only)* · `webhooks:read` *(API key only)* · `webhooks:write` *(API key only)* |
| Purchase scanner | 10 | all | `purchase_invoices:delete` · `purchase_invoices:read` · `purchase_invoices:write` |
| Tax reports | 9 | all | `tax_reports:read` · `tax_reports:write` |
| API keys | 7 | 3 | `account:read` · `account:write` *(API key only)* |
| Additional-NIF offer redemptions | 6 | 0 | `companies:read` *(API key only)* · `companies:write` *(API key only)* |
| FacturaE | 5 | all | `facturae:read` · `facturae:write` |
| Company account | 4 | 3 | `account:read` · `account:write` *(API key only)* |
| Developer settings & request logs | 4 | 0 | `developers:read` *(API key only)* |
| Emails | 3 | 0 | `emails:read` *(API key only)* |
| Holidays | 3 | all | `holidays:read` |
| Notifications | 3 | all | `notifications:read` · `notifications:write` |
| Presence | 3 | all | `presence:read` |
| Users | 2 | all | `users:read` |
| Agenda | 1 | all | `tasks:read` |
| Consolidated panel (gestoría) | 1 | 0 | `companies:read` *(API key only)* |

The rows are **measured, not hand-maintained**: the domain is the
`App\Mcp\Tools\<Domain>` namespace of every tool the public MCP server actually
publishes, and the scopes are those tools' declared `RequiredScope`, counted
through the same code path that answers `tools/list` for a reference holder
(enterprise plan, scope `*`; `php artisan public-api:export-stats`). Measured
**2026-10-17** against backend `feat/epic-nif-axis-api` @ `e639f925ff`. Every
scope belongs to the closed scope catalog of the contract; `clients:*` and
`suppliers:*` are no longer in it, which is why those two rows are gone.

`update_series` edits a series under the fiscal guards of the
numbering: the code and mask are fixed once documents exist, the purpose once it
has an invoice, and all numbering fields lock when the AEAT accepts a record; a
series is never deleted, archive it.

PDF downloads and payment receipts use the transversal `pdfs:read` scope;
activity/event logs use `events:read`.

The counts above are a snapshot and the catalog grows. **Discover the tools at
runtime with `tools/list`**: it is the authoritative list for the current
session, and a tool missing from this table is not missing from the server.

### Transport control documents (DeCA)

The DeCA (*documento de control*) is the Spanish electronic administrative
control document of public road freight transport, national or cabotage, with
origin and destination in Spain (Orden FOM/2861/2012). It identifies the
parties, shipments, goods, vehicle and dates, and travels with the driver as a
PDF whose QR code opens a permanent public URL. It is **not a delivery note, an
invoice or a VeriFactu record**: it can be pre-filled from delivery notes but
never changes their numbering, stock or invoicing. It is not required in private
complementary transport (own vehicles and drivers), parcel delivery of a few
packages, removals, damaged or broken-down vehicles carried in special vehicles,
or transport that needs no prior authorisation. Each DeCA declares the
company's role in `company_role`: `shipper` (contractual shipper) or `carrier`
(effective carrier).

Its tools need the `transport_documents` module (Documentos de control), which
requires the Delivery notes module and comes with the same plans: Profesional,
Avanzado and Enterprise. All four scopes can be granted over OAuth;
`transport_documents:delete` and `transport_documents:transition` are shown
with a warning and not pre-checked.

Statuses: `draft` → `issued` → `closed`, by hand or automatically 7 days after
the last transport date. A manual close can be reopened back to `issued` before
that deadline; an automatic one cannot. `cancelled` and `superseded` are
terminal. Modifying keeps the DeCA `issued` with a new version under the same
number, URL and QR.

1. **Find** — `search_transport_documents` (filters `status`, transport dates,
   `company_role`, `carrier_tax_id`, `delivery_note_id`, `q`),
   `get_transport_document`, `get_transport_document_statuses`.
2. **Draft** — `create_transport_document` (only `company_role` is required;
   `delivery_note_ids` adds one shipment per delivery note),
   `update_transport_document`, `delete_transport_document` (drafts only: an
   issued DeCA is never deleted).
3. **Issue** — `issue_transport_document` assigns the next number of the `DC`
   series, the public URL with its QR and version 1 of the PDF. It needs the
   shipper (name, tax ID and address), the carrier (name and tax ID), the
   tractor plate and, in every shipment, origin, destination, goods, measure and
   a transport date of today or later (Madrid time). A `422` lists what is
   missing in `error.details.missing`.
4. **Hand the copy to the driver** — `send_transport_document` emails the PDF
   and the URL (up to 5 recipients; without `to`, the carrier contact), or share
   the URL from `get_transport_document_pdf` (URL and metadata, never the bytes).
5. **During the service** — `modify_transport_document` (only what changes, plus
   `reason` and `data_origin`: `company` or `carrier_reported`; the parties never
   change, so cancel and issue a new one), `close_transport_document`,
   `reopen_transport_document` (with `reason`).
6. **End it** — `cancel_transport_document` (with `reason`), or
   `supersede_transport_document` when the carrier's own DeCA replaces it (with
   `reference` and `reason`). `get_transport_document_evidence` returns the
   issuance evidence, the proof of having issued it.

**Always ask the user to confirm before calling `issue_transport_document`,
`modify_transport_document`, `cancel_transport_document`,
`supersede_transport_document` or `send_transport_document`**, stating which
DeCA and what will happen: they are irreversible (a number consumed, a version
published, a terminal state, an email sent). Pass an `idempotency_key` and reuse
it on a retry so the effect does not happen twice. The QR image and the
proof-of-issuance PDF are REST-only downloads, and loading places are managed in
the app. Guide: <https://docs.factuarea.com/guides/transport-documents>.

### Purchase scanner flow

The purchase scanner turns supplier invoices and receipts into draft
expenses. Its tools live under the `purchase_invoices:*` scopes and need a plan
that includes the scanner. Documents arrive from the app, the scanner mailbox
or the REST API; there is no MCP tool to upload them.

1. **Find** — `search_purchase_scans` (by status, source, dates),
   `get_purchase_scan_stats` for the counters, `list_purchase_scan_emails` for
   what the mailbox received. Search responses include `facets`; use those counts rather than inferring totals from one cursor page.
2. **Inspect** — `get_purchase_scan`: extraction with evidence, issues,
   `available_actions` and the current `version`. Every mutation below sends
   that version as `expected_version`; a stale one fails, so re-read and ask
   again.
   `attempts_total` counts all attempts even when the detail only includes recent ones.
3. **Review** — `save_purchase_scan_review` with the user's corrections;
   `retry_purchase_scan` starts or re-queues a recoverable scan.
4. **Finish** — one of:
   - `convert_purchase_scan` creates the draft expense;
   - `resolve_purchase_scan_duplicate` links it to an existing expense
     (`link_existing`) or archives it (`archive`);
   - `archive_purchase_scan` archives it (`restore_purchase_scan` undoes it).

**Always ask the user to confirm before calling `convert_purchase_scan`,
`resolve_purchase_scan_duplicate` or `archive_purchase_scan`**, stating which
scan and what will happen. A `429` with code `ocr_company_quota_exceeded` means
the monthly quota is used up and is not recoverable before `Retry-After`: do
not retry in a loop. Profesional includes 100 scans/month and 10/day; Avanzado includes 400 scans/month and 40/day. Quotas are shared across all company users and channels; Enterprise quotas are per contract. If a saved scan has `deferred_reason=ocr_daily_quota_reached` and `deferred_until`, the original is already safe and processing resumes automatically at that time. Explain the daily wait, preserve the scan ID and do not upload it again or spend retries while deferred. The mailbox always requires human review.

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
- `employee_seat_payment_method_required` (`402`) — creating or reactivating an
  employee charges a seat whenever the plan bills (also when the subscription is
  `past_due` or the plan was granted); Enterprise, managed companies and an
  active trial are exempt. The company has no payment method: send the user to
  `error.details.payment_setup_url`. Nothing was created.
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
   `search_products` (or `find_contact_by_tax_id`), then `create_invoice`. There
   is no `search_clients` / `create_client`: a customer is a **role** of a
   contact (`roles: ["customer"]`), and so is a supplier — `assign_contact_role`
   adds the other role to the same tax id instead of duplicating it.
2. **Stay in the sandbox** until the flow is correct.
3. **Use the discrete transition tool** for state changes, and surface the
   Spanish `message` (or map by `code`) when a tool returns an error.
4. **Page with the cursor** (`has_more` / `next_cursor`), never with page numbers.
