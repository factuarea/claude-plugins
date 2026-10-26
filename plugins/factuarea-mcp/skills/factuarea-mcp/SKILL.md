---
name: factuarea-mcp
description: Operate the Factuarea MCP server — invoicing, quotes, pro-formas, delivery notes, transport control documents (DeCA), recurring invoices & expenses, contacts (customers and suppliers are roles of one contact), products, price lists, document series, taxes, VeriFactu (AEAT), FacturaE, tax reports, PDF templates and per-document presentation, time tracking, tasks and projects, automations and webhooks for Spanish companies. Use this when the user has the Factuarea MCP connected (or wants to connect it) and asks Claude to read or act on their business data — search/create/send invoices, manage contacts, choose or revise the PDF template of a document, issue the DeCA for a road freight transport, follow tasks and projects, check VeriFactu, configure webhooks — and to interpret scopes, cursor pagination, tool errors (`isError` results with their `_meta` contract), ETag/CAS preconditions, pending PDFs, and test (sandbox) mode.
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
  sees, **664 tools**. The owner is acting on their own account, so the key can
  cover everything, including the privileged operations below. The managed-account
  tools (provisioning, plan changes, ending a management) are
  **not** in that figure: they need the privileged scope `accounts:read` /
  `accounts:write`, which `*` does **not** cover, so they only appear for a key
  that carries `accounts:*`, granted by a superadmin. OAuth never grants it.
  The account-administration tools (members, invitations, NIF transfers and the
  ownership transfer) are outside the figure too: their scopes (`members:*`,
  `invitations:*`, `nif_transfers:*`, `account:owner`) must be granted one by
  one, because `*` does not cover them either.
- **OAuth (third-party app, curated scopes)** → **540 tools**. The remaining
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

So an OAuth session with read-only scopes on an Esencial (`emprendedor`) plan will list far
fewer than 540 tools — that's expected, not an error.

**Discovery is `tools/list`, nothing else.** The tools a session sees depend on
its scopes, the plan and the active modules (for example the template and brand
write tools need the `pdf_templates` module, while their reads, `preview_pdf_template`
and the artifact tools do not). Do not assume a tool exists because this skill
or a guide names it: list first, and if it is missing, report which scope or
module would unlock it instead of improvising another tool. The counts below
measure the whole catalog on a given date; they never tell you what the current
session can call.

## Product terminology and stable contracts

The product calls purchases **Expenses** (ES: Gastos; CA: Despeses) and sales
**Invoices** (ES: Facturas; CA: Factures). Recognize the former names “purchase
invoices” and “sales invoices” in user requests, but use the current names in
responses. A supplier invoice is still a fiscal supporting document for an expense.
Resource names such as `purchase_invoices`, scopes, event IDs, tool names, SDK
methods and routes stay unchanged. Never invent an `expenses` resource or rename
a tool to match a display label.

## Tool domains (41)

Tools are named `<verb>_<noun>` (e.g. `search_invoices`, `create_contact`,
`mark_invoice_as_paid`). **Tools** is what an API key with scope `*` sees;
**OAuth** is what a consent grant can reach (`all` when the whole domain is
reachable).

The catalog is **664 tools** across **41 domains**, of which **540** are
reachable by an OAuth consent grant and **124** are API-key only. Privileged
`accounts:*` tools (managed accounts) and the account-administration tools are
outside these figures: only a credential granted those scopes sees them.

| Domain | Tools | OAuth | Scopes |
| --- | ---: | ---: | --- |
| Tasks | 52 | 46 | `tasks:delete` *(API key only)* · `tasks:read` · `tasks:write` |
| Invoices | 51 | all | `invoices:delete` · `invoices:read` · `invoices:send` · `invoices:void` · `invoices:write` · `pdfs:read` |
| Products | 40 | all | `products:delete` · `products:read` · `products:write` |
| VeriFactu | 31 | 20 | `verifactu:read` · `verifactu:write` *(API key only)* |
| Time tracking | 29 | 17 | `payroll_exports:read` · `time_entries:read` · `time_entries:write` *(API key only)* |
| Contacts | 28 | all | `contacts:delete` · `contacts:read` · `contacts:write` |
| Connected stores & integrations | 26 | 0 | `integration_events:read` *(API key only)* · `integration_events:write` *(API key only)* · `payouts:read` *(API key only)* · `shopify_store:write` *(API key only)* · `stores:read` *(API key only)* · `stores:write` *(API key only)* · `stripe_autoinvoicing:read` *(API key only)* · `stripe_autoinvoicing:write` *(API key only)* · `woocommerce_store:write` *(API key only)* |
| Delivery notes | 26 | 25 | `delivery_notes:delete` · `delivery_notes:gdpr_forget` *(API key only)* · `delivery_notes:read` · `delivery_notes:transition` · `delivery_notes:write` · `pdfs:read` |
| Absences | 25 | 10 | `absences:read` · `absences:transition` *(API key only)* · `absences:write` *(API key only)* |
| PDF templates & brands | 25 | all | `pdf_templates:read` · `pdf_templates:write` |
| Pro-formas | 24 | all | `pdfs:read` · `proformas:delete` · `proformas:read` · `proformas:send` · `proformas:transition` · `proformas:write` |
| Quotes | 24 | all | `pdfs:read` · `quotes:delete` · `quotes:read` · `quotes:send` · `quotes:transition` · `quotes:write` |
| Projects | 22 | 19 | `projects:delete` *(API key only)* · `projects:read` · `projects:write` · `invoices:write` |
| Purchase invoices | 19 | all | `pdfs:read` · `purchase_invoices:delete` · `purchase_invoices:read` · `purchase_invoices:transition` · `purchase_invoices:write` |
| Recurring invoices | 19 | all | `recurring_invoices:delete` · `recurring_invoices:read` · `recurring_invoices:transition` · `recurring_invoices:write` |
| Automations | 18 | 17 | `automation_runs:read` · `automations:delete` *(API key only)* · `automations:read` · `automations:write` |
| Employees | 18 | all | `employees:read` · `employees:write` |
| Taxes | 18 | all | `taxes:delete` · `taxes:read` · `taxes:write` |
| Account NIFs & usage | 15 | 1 | `account:read` · `companies:delete` *(API key only)* · `companies:read` *(API key only)* · `companies:write` *(API key only)* |
| Series | 15 | all | `series:read` · `series:write` |
| Transport control documents (DeCA) | 15 | all | `pdfs:read` · `transport_documents:delete` · `transport_documents:read` · `transport_documents:transition` · `transport_documents:write` |
| Price lists | 13 | all | `price_lists:read` · `price_lists:write` |
| Webhooks & events | 13 | all | `events:read` · `webhooks:delete` · `webhooks:read` · `webhooks:write` |
| Employee seats | 11 | all | `employees:read` · `employees:write` |
| Work schedules | 11 | 5 | `work_schedules:read` · `work_schedules:write` *(API key only)* |
| Account webhooks | 10 | 0 | `webhooks:delete` *(API key only)* · `webhooks:read` *(API key only)* · `webhooks:write` *(API key only)* |
| Purchase scanner | 10 | all | `purchase_invoices:delete` · `purchase_invoices:read` · `purchase_invoices:write` |
| Tax reports | 9 | all | `tax_reports:read` · `tax_reports:write` |
| API keys | 7 | 3 | `account:read` · `account:write` *(API key only)* |
| Additional-NIF offer redemptions | 6 | 0 | `companies:read` *(API key only)* · `companies:write` *(API key only)* |
| FacturaE | 5 | all | `facturae:read` · `facturae:write` |
| PDF previews & artifacts | 5 | all | `pdfs:read` · `pdf_templates:read` |
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
**2026-10-18**, with the PDF template, presentation and artifact tools. Every
scope belongs to the closed scope catalog of the contract; `clients:*` and
`suppliers:*` are no longer in it, which is why those two rows are gone.
`preview_pdf_template` is the only tool that needs two scopes at once
(`pdfs:read` and `pdf_templates:read`).

Some tools also need a module of the company's plan, on top of the scope:

| Module | Tools |
| --- | --- |
| `pdf_templates` | the 14 writes of the template and brand library (`create_`, `update_`, `duplicate_`, `archive_`, `restore_` and `publish_…_revision` of `pdf_template` and `pdf_commercial_identity`, `set_pdf_template_defaults`, `set_pdf_template_contact_default`, `upload_pdf_template_asset`); its reads do not |
| `series_settings` | `assign_series_pdf_template` |
| `invoices`, `quotes`, `proformas`, `delivery_notes` | the presentation tools of that document (`get_`, `list_`, `assign_`, `revise_…_presentation`), plus `list_invoice_administrative_revisions` and `revise_invoice_administrative_routing` for invoices |
| `facturae` | `send_invoice_to_face`, `cancel_face_submission`, `get_face_submission`, `list_invoice_face_submissions`, `get_invoice_facturae_link` |
| `recurring_invoices` | `generate_recurring_invoice` |
| `control_horario` | the `*_employee_batch` tools and the `*_employee_seat_offer_redemption` tools |
| `gestoria` | the `*_gestoria_seat_offer_redemption` tools |

`update_series` edits a series under the fiscal guards of the
numbering: the code and mask are fixed once documents exist, the purpose once it
has an invoice, and all numbering fields lock when the AEAT accepts a record; a
series is never deleted, archive it.

PDF downloads, PDF artifacts and payment receipts use the transversal
`pdfs:read` scope; activity/event logs use `events:read`. Choosing or revising
the presentation of a document uses the scopes the document already has
(`invoices:write`, `quotes:write`, `proformas:write`, `delivery_notes:write`,
`series:write`).

The counts above are a snapshot and the catalog grows. **Discover the tools at
runtime with `tools/list`**: it is the authoritative list for the current
session, and a tool missing from this table is not missing from the server.

### PDF templates, presentation and artifacts

The company keeps a library of PDF **templates** and **commercial identities**
(brands), and every invoice, quote, pro-forma and delivery note has a
**presentation**: which template, brand and paper format its PDF uses. Concepts
and exact fields live in the guides:
[templates](https://docs.factuarea.com/guides/document-templates) ·
[previews and artifacts](https://docs.factuarea.com/guides/pdf-template-previews) ·
[document presentations](https://docs.factuarea.com/guides/document-presentations) ·
[invoice business data](https://docs.factuarea.com/guides/invoice-business-data).
Tool families (names as in `tools/list`; read each input schema before calling):

| Family | Tools | Scopes |
| --- | --- | --- |
| Template library | `list_pdf_templates`, `get_pdf_template`, `create_pdf_template`, `update_pdf_template` (name and description only), `publish_pdf_template_revision`, `duplicate_pdf_template`, `archive_pdf_template`, `restore_pdf_template`, `get_pdf_template_impact`, `get_pdf_template_revision` | `pdf_templates:read` / `:write` |
| Brands | the same verbs with `pdf_commercial_identity` / `pdf_commercial_identities` (`create_`, `update_`, `publish_…_revision`, `archive_`, `restore_`, `get_…_impact`, `get_…_revision`, `list_`, `get_`) | `pdf_templates:read` / `:write` |
| Defaults and assets | `get_pdf_template_defaults`, `set_pdf_template_defaults`, `get_pdf_template_contact_default`, `set_pdf_template_contact_default`, `upload_pdf_template_asset`, `get_pdf_template_asset`. `set_pdf_template_defaults` also admits the «control documents» default (`type_defaults` entry `transport-document` / `complete`), which only accepts templates whose `document_kind` is `transport-document` (control templates, so `commercial` ones are rejected), and every version in `get_transport_document` carries a read-only `presentation` with the design it was painted with | `pdf_templates:read` / `:write` |
| Series template | `get_series_pdf_template`, `assign_series_pdf_template` (needs the `series_settings` module) | `series:read` / `series:write` |
| Document presentation | `get_invoice_presentation`, `list_invoice_presentations`, `assign_invoice_presentation`, `revise_invoice_presentation` and the same four for `quote`, `proforma` and `delivery_note` (`get_quote_presentation`, `list_delivery_note_presentations`, `revise_proforma_presentation`, …); `list_invoice_administrative_revisions`, `revise_invoice_administrative_routing` | the document's own scopes (and its module) |
| Preview and artifacts | `preview_pdf_template`, `prepare_pdf_artifact`, `render_pdf_artifact`, `get_pdf_artifact`, `read_pdf_artifact` | `pdfs:read` (+ `pdf_templates:read` for the preview) |

Rules that keep you out of trouble:

- **Never guess the library state.** List templates and read the document's
  presentation (`get_*_presentation`) before assigning anything. The state tells
  you `can_select`, `can_revise` and the versions to send back.
- **Versions replace headers.** MCP has no `If-Match`: send `expected_version`
  (or `expected_selection_version` on a document create/update) as the tool
  argument, taken from the last read. Publishing, archiving and restoring a
  template or brand also asks for the `expected_impact_fingerprint` of
  `get_*_impact`: read the impact first, show the user which defaults, series,
  contacts or recurring invoices it touches, and only then call. Archive takes
  one decision per association; do not invent them.
- **Recovering from a precondition failure.** `412` (tag mismatch) and `409`
  (`*_version_conflict`, `pdf_presentation_conflict`, `pdf_library_impact_conflict`)
  mean the state moved after you read it: read again, re-evaluate whether the
  user's intent still holds, then retry with the fresh version. Do not loop with
  the old value and never "fix" it by guessing a higher number. `409
  pdf_presentation_context_changed` means the document, template or brand changed
  after the preview: preview again.
- **`428` is a request for proof, not an error to bypass.** Issuing, sending,
  or accepting a document can answer
  `pdf_presentation_precondition_required` when revisioned presentation is active
  for the company. Call `preview_pdf_template` with `source.kind:
  "persisted_draft"` and the `document_id`, then pass the seven fields it returns
  (`expected_selection_version`, `expected_source_token`,
  `expected_preview_context_fingerprint`, `expected_template_revision_id`,
  `expected_commercial_identity_revision_id`, `purpose`, `format`) as the send or
  issue tool's schema declares them. Show the user what will be delivered first.
  The bulk send and bulk status tools of quotes, pro-formas and delivery notes take
  `presentation_preconditions` as a map from each document UUID (it must be in `ids`)
  to its own seven-field precondition, with `purpose` `complete` and `format` `a4`;
  for delivery notes only when delivering.
  `accept_quote` and `accept_proforma` need the seven fields only for the
  document's **first capture**. One that already has a retained capture (shared
  as a draft, for example) is accepted without them; pass the capture the user
  reviewed as `expected_presentation_uuid` if you have it, and a `409
  pdf_presentation_conflict` then means it is no longer the current one: read
  again and ask, nothing was written.
  If the company has not activated revisioned presentation, those arguments are
  ignored and the call behaves as before; the visual actions themselves (assign or
  revise a presentation, artifacts) answer `422 pdf_presentation_not_ready`, which
  is a company state, not something to retry.
- **Omitted is not `null`.** On updates an absent field keeps its value and an
  explicit `null` clears it (`pdf_template_id: null` goes back to inheriting;
  `payment_terms: null` removes the schedule of a draft; `[]` means explicitly no
  schedule). Send `null` only when the user asked to clear. Business data of an issued invoice is frozen; only its administrative
  routing can be revised.
- **With instalments, `due_on` is the last one.** When an invoice has a
  non-empty `payment_terms`, it falls due on the date of its last instalment:
  send that date as `due_on` in `create_invoice`, and in `update_invoice` either
  send it or omit `due_on` while replacing `payment_terms` so it is taken from the
  schedule. A draft stores a different date, but issuing it (`issue_invoice`, or
  `create_invoice` with issuing options), scheduling it (`schedule_invoice`) or
  rescheduling it (`reschedule_invoice`) answers
  `422 invoice_due_date_not_last_instalment`. Nothing changes: the invoice stays
  a draft, or keeps its scheduled date. Fix `due_on` or the instalment dates and
  try again. `duplicate_invoice` dates the new draft today and moves every
  instalment by the days between both issue dates, each keeping its amount, so
  `due_on` is the last moved instalment: review the dates with the user before
  issuing the copy.
- **Assets travel as base64.** `upload_pdf_template_asset` takes `kind`
  (`logo` or `imago`), `image_base64` (JPEG, PNG or WebP, at most 2048 KiB once
  decoded), `mime` and `filename`; REST uses `multipart/form-data` for the same
  operation (`POST /v1/companies/{company}/pdf-templates/assets`). Do not paste a large image through
  the conversation: if it does not fit, tell the user to upload it with the REST
  API or the dashboard and give you the `asset id`.
- **Brands on dark backgrounds and brand size.** A brand revision
  (`create_pdf_commercial_identity`, `publish_pdf_commercial_identity_revision`,
  or the unsaved brand of `preview_pdf_template`) can carry a version of each
  image for dark backgrounds: `logo_dark_asset_id` (an asset of kind `logo`,
  only next to `logo_asset_id`) and `brand_image_dark_asset_id` (kind `imago`,
  only next to `brand_image_asset_id`). Without one, on a dark background where
  the brand does not contrast, `dark_background_fallback` decides: `silhouette`
  (the default, a white silhouette drawn automatically) or `plate` (the brand on
  a light plate). `brand_size` (`small`, `medium` by default, or `large`) is the
  brand's default size, and a template uses it when its `branding.size` is
  `inherit`, the default for new templates; a template that sets its own size
  keeps it. Offer these only when the user asks about dark designs or logo size;
  never upload a dark version they did not provide.
- **PDFs can be pending.** `get_*_pdf` and `render_pdf_artifact` may answer a
  non-ready state (`prepared`, `queued`, `processing`) with `retry_after` seconds,
  not the file. Wait that long, repeat the same read (`get_pdf_artifact`) and stop
  after a bounded number of attempts; do not call `prepare_pdf_artifact` or
  `render_pdf_artifact` again to speed it up. A `get_*_pdf` whose earlier render
  failed in a way that can be retried claims it again by itself instead of
  repeating the old failure: it answers `queued`, the download link or the new
  outcome, so repeat the same call after `retry_after`, bounded.
  `failed` with `error.retryable: true` in `get_pdf_artifact` is the only case for
  a new `render_pdf_artifact` with a new `idempotency_key`. Terminal: a PDF that
  no render can produce fails with its code and `http_status` `500`
  (`pdf_engine_profile_unavailable`, `pdf_payload_resource_unavailable`,
  `pdf_image_resource_unavailable`, `pdf_original_unavailable`,
  `pdf_original_corrupt` or `pdf_original_layout_unavailable`), and
  `pdf_signature_personal_data_forgotten` (`410`).
  `read_pdf_artifact` returns an authorized link, not bytes. A preview expires
  after 24 hours and is never the official PDF.
- **Public links.** `update_*_public_link` with `action: "publish"` requires
  `publication_context` (`presentation_id` and `expected_binding_version` from the
  document's `presentation` block). Hand the user `publication.public_url` exactly
  as returned, and only when `publication.state` is `ready`; never build a URL
  from an id. Treat every `download_url` the same way. The link's own `url` has
  no version selector and opens the latest version shared publicly, so it
  follows each new publication; `publication.public_url` pins one version. Give
  the user the one that matches what they asked for.
- **FACe.** `send_invoice_to_face` (module `facturae`) creates a durable attempt
  identified by `submission_id`. If it fails with `face_transmission_failed`,
  `face_submission_completion_failed` or answers `409
  face_transmission_uncertain`, the invoice may already be at FACe: **do not call
  it again blindly and do not make up a new `submission_id`**. Keep the
  `attempt_id` from `error.details`, read the attempt with `get_face_submission` /
  `list_invoice_face_submissions` and act on its `status` (see the
  [FACe guide](https://docs.factuarea.com/guides/face-invoicing)). A
  `transmission_uncertain` attempt is reconciled by Factuarea; the user contacts
  support.

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

State changes are **discrete tools**, not a generic status setter: e.g.
`mark_invoice_as_paid`, `send_invoice`, `void_invoice`, `accept_quote`,
`convert_quote`, `sign_delivery_note`, `pause_recurring_invoice`,
`generate_recurring_invoice` (generates the next invoice now, and may issue and
send it according to the recurrence's `generation_mode`; it needs the
`recurring_invoices` module and an `idempotency_key`). Pick the tool that names
the transition.

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
  `starting_after`. There are no page numbers, except in the lists the contract
  declares as offset lists: the template and brand libraries
  (`list_pdf_templates`, `list_pdf_commercial_identities`) and the
  `list_*_presentations` tools take `page` / `per_page` and report `meta.total`.
  Read the input schema of the tool before looping.
- **Amounts** are EUR unless stated; **dates** are `YYYY-MM-DD`.
- **File uploads** (product media, purchase-invoice attachments,
  FNMT certificates, PDF template assets) travel as **base64 strings** in the
  tool arguments — the MCP transport has no multipart, and each tool states its
  own decoded size limit. The REST API takes the same files as `multipart/form-data`
  with larger practical room. The server decodes, validates size and magic
  bytes, then processes. Downloads come back as base64 too, except PDF artifacts,
  where `read_pdf_artifact` returns an authorized link.
- **Irreversible tools take `idempotency_key`.** Send one per logical intention
  (a stable value you keep) on creates, sends, issues, assigns, revisions,
  renders and uploads, and reuse it only to retry that same call. A new key means
  a new intention; the same key with different arguments is `422
  idempotency_key_reused`, and a retry while the first call is still running is
  `409 idempotency_key_in_use` (wait, then retry with the same key). A replay
  returns the stored result before any version check, so a retry after a timeout
  does not fail on your own first attempt.

## Errors you'll see

A failure reaches you in one of two shapes. Both carry the `code` of the REST
error contract: branch on it, never on the human message (messages are in
Spanish). Details: <https://docs.factuarea.com/mcp/errors>.

- **Raised inside the tool → a result with `isError: true`.** A business rule, a
  missing resource or a conflict found while the tool runs does **not** come back
  as a JSON-RPC error: `tools/call` answers a normal result flagged
  `isError: true`, so you can read it and correct course. `content[0].text` is
  the domain message, and `_meta["com.factuarea/error"]` carries the contract:
  `http_status`, `code`, `hint` and, when they apply, `param`, `subcode` and
  `details` (for example `existing_resource_id` of a duplicate, or the
  `attempt_id` of a FACe attempt). Read that `_meta` instead of parsing the text.
  An `isError` result **without** it is an unexpected server failure: report it
  and do not retry it in a loop.

  ```json
  { "isError": true,
    "content": [{ "type": "text", "text": "<the domain message, in Spanish>" }],
    "_meta": { "com.factuarea/error": {
      "http_status": 422, "code": "invoice_not_editable_in_current_state",
      "hint": "<the same message>" } } }
  ```

- **Rejected before the tool runs → a JSON-RPC `error`.** Authentication, scopes
  and plan, throttling, the fiscal guardrails, idempotency and retired tool names
  are checked first, and nothing runs when they fail. `error.code` is a number
  in `-32099..-32000` and `error.data` holds the same contract (`code`,
  `http_status`, `hint`, …). One number covers several causes (`-32005` is both
  `insufficient_scope` and `module_not_in_plan`), so read `error.data.code`.

The codes you will meet most, in either shape:

- `insufficient_scope` (`403`) — the token/key lacks the tool's `RequiredScope`.
  The fix is to re-authenticate (`/mcp` → Authenticate) and approve the scope,
  or use a key that has it. Remember that the owner-only groups listed under
  *Channel policy* are **API-key only**.
- `module_not_in_plan` — the tool's module (see *Tool domains*) isn't in the
  company's plan. Not a bug; the plan must include that module.
  `addon_not_active` means the company has no active plan with API access at all
  (an expired trial, a lapsed subscription).
- `employee_seat_payment_method_required` (`402`) — creating or reactivating an
  employee charges a seat whenever the plan bills (also when the subscription is
  `past_due` or the plan was granted); Enterprise, managed companies and an
  active trial are exempt. The company has no payment method: send the user to
  `details.payment_setup_url`. Nothing was created.
- **`422`** — validation or **business-rule violation** (invalid status
  transition, document not in an editable state, payment date out of range).
  Business-rule violations are `422`, not `403`/`409`. Also `422`:
  `idempotency_key_reused` (the same `idempotency_key` with other arguments: use
  a new key for a new intention) and `mcp_guardrail_violation` (a fiscal rule
  rejected the call before anything ran: read the resource named by
  `guardrail_uri` and do the operation that applies, such as annulling instead of
  deleting; retrying the same call fails again).
- **`409`** — duplicate creation, a concurrency lock, a stale version (CAS), or
  `idempotency_key_in_use` (the first call with that key is still running). For
  a stale version, read again and retry with the new one.
- **`412` / `428`** — the precondition is stale (`412`) or missing (`428`):
  see *PDF templates, presentation and artifacts*. Both are recoverable by
  reading the current state, not by retrying the same arguments.
- **`429`** / **`503`** — throttled, or a PDF not ready
  (`pdf_artifact_not_ready`). Honour `Retry-After` (or the `retry_after` field of
  the result): wait that many seconds before retrying; don't hammer.
- **`500` with a PDF code** — `pdf_original_unavailable`, `pdf_original_corrupt`,
  `pdf_original_layout_unavailable` (the original is intact, but this release no
  longer serves the layout a signature or legal-QR capture keeps),
  `pdf_engine_profile_unavailable`, `pdf_payload_resource_unavailable` or
  `pdf_image_resource_unavailable`. The render failed terminally and nothing
  was queued: do not retry it in a loop; tell the user and point them to support.
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
- PDF templates: <https://docs.factuarea.com/guides/document-templates> · <https://docs.factuarea.com/guides/pdf-template-previews> · <https://docs.factuarea.com/guides/document-presentations> · <https://docs.factuarea.com/guides/invoice-business-data>
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
4. **Page with the cursor** (`has_more` / `next_cursor`), never with page numbers
   (the template, brand and presentation-history lists are offset lists: use
   `page` / `per_page` and `meta.total`).
