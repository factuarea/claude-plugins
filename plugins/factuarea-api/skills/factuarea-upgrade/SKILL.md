---
name: factuarea-upgrade
description: Realign an existing Factuarea integration with the current contract — detect drift between the user's code and the live OpenAPI spec, and between their pinned SDK version and the latest published one. Use this when the user is upgrading `@factuarea/sdk` or `factuarea/factuarea-php`, saw a deprecation or `Sunset` header, pinned a `Factuarea-Version` and wants to move it forward, hit a failure after an API change, or asks what changed and what they must update. Produces a diff report classifying each difference as breaking or additive, with the order to apply them. Triggered by something having **changed** on Factuarea's side — not for operating the user's account through MCP tools (that is `factuarea-mcp`); not for building a new integration (`factuarea-implement`); not for auditing correctness against the rules as they stand today (`factuarea-audit`).
---

# Upgrading a Factuarea integration

The job: compare **what the user's code assumes** against **what is published
now**, and hand back a change list ordered so nothing breaks midway.

Two sources, both live — never answer from memory:

- **Live spec**: <https://api.factuarea.com/v1/openapi.json> (the same document
  the API serves; the `webhooks` block describes delivery headers and payloads).
  The spec URL is itself a **root route** — it describes the whole v1 surface and
  is identical for every credential, so it never takes a `/companies/{company}`
  segment.
- **Published SDK versions**: npm `@factuarea/sdk`, Packagist `factuarea/factuarea-php`.
  Read the registry, plus the repo's `CHANGELOG.md`, for what changed between the
  pinned version and the latest.

Also worth checking: <https://docs.factuarea.com/changelog/launch> and
<https://docs.factuarea.com/guides/versioning>.

## Step 1 — Pin down what the code assumes

Inventory, with a `file:line` for each:

- **Operations called** — paths and methods, whether via SDK method or raw HTTP.
- **Response fields read** — every property the code destructures, maps or
  persists. This is where silent drift hides.
- **Request fields sent**, including which are always present.
- **Enum values compared against** — statuses, document types, error `code`s.
- **Error `code`s branched on.**
- **The pinned `Factuarea-Version`**, if the code sends the header, and any
  version pinned on the API key itself.
- **SDK version** from `package.json` / `composer.json` and the lockfile (the
  lockfile is what's installed; the manifest is only the range).

## Step 2 — Diff against the live spec

For each item, check the spec:

- Operation **missing** → breaking. Look for the documented replacement (a
  canonical route that replaced a legacy alias, or a renamed resource) and name
  it in the finding. If there is no replacement, say so — don't invent one.
- Operation present but **`deprecated: true`** → not yet breaking. Note the
  `Sunset` date. In `/v1` a deprecated endpoint **keeps working until `/v2`**,
  with at least 12 months of warning, so this is scheduled work, not an outage.
- **Response field** absent from the schema → breaking for code that reads it.
- **Field type changed** → breaking.
- **Request field newly required** → breaking.
- **New optional request field / new response field / new endpoint / new enum
  value** → additive.
- **Error `code` or status** the code branches on that no longer exists →
  breaking.

Four shapes of drift are live right now and turn up in almost every report.
Recognise them instead of rediscovering them:

- **The company axis.** Company-scoped resources moved from the flat form to
  `/v1/companies/{company}/…`, with `{company}` the company UUID. An operation
  that looks *missing* under its flat path is usually present under the axis —
  name the axis form as the documented replacement. Two families never take the
  segment: the **root catalogs** (`/v1/openapi.json`, `/v1/event-catalog`,
  `/v1/tax-catalog`, `/v1/payment-methods`, `/v1/payroll-export-formats`) and
  **credential introspection** (`/v1/me`, which replaced `/v1/account`).
  Account-level resources take the **account** axis instead —
  `/v1/accounts/{account}/…`, e.g. `/v1/accounts/{account}/api-keys`. Never
  repair drift by prefixing everything that contains `/v1/`: that breaks the
  root catalogs in the opposite direction.
- **Retired resources.** `clients` and `suppliers` are gone. They are **not**
  re-anchored: `/v1/companies/{company}/clients` does not exist and answers
  `404`. The replacement is `contacts` with a role —
  `POST /v1/companies/{company}/contacts` with `roles: ["customer"]` or
  `roles: ["supplier"]`, responses carrying `"object": "contact"`. The matching
  scopes are `contacts:read|write|delete`; `clients:*` and `suppliers:*` are no
  longer in the scope catalog.
- **The account claim voucher became the NIF transfer.** The three claim-voucher
  operations of an account — `public-api.v1.account.claim_tokens.list`,
  `.create` and `.accept` — are **removed, not deprecated**. Each has a named
  replacement, so name it in the finding:
  `claim_tokens.list` → `public-api.v1.account.nif_transfers.list`
  (`GET /v1/accounts/{account}/nif-transfers`), `claim_tokens.create` →
  `public-api.v1.account.nif_transfers.create`
  (`POST /v1/accounts/{account}/nif-transfers`) and `claim_tokens.accept` →
  `public-api.v1.account.nif_transfers.accept`
  (`POST /v1/accounts/{account}/nif-transfers/accept`). There is also a new
  `public-api.v1.account.nif_transfers.revoke`. The scopes move with them
  (`claim_tokens:read|write` → `nif_transfers:read|write`) and so do the errors
  (`claim_token_expired` → `nif_transfer_expired`, `claim_token_invalid` →
  `nif_transfer_invalid`). Do not read the surviving
  `POST /v1/accounts/{account}/claim-tokens` as the old operation: it is
  `public-api.v1.managed_accounts.claim_tokens.create`, which reissues the claim
  voucher of a *managed* account and has nothing to do with moving a tax ID.
- **The gestoría portfolio became the account model.** The old shape — a managing
  company with child companies, switched with the `X-Active-Profile` header,
  child API keys, and the gestoría module and seats — is gone. Nothing of it is
  re-anchored: the header is retired and answers `parameter_unknown` with the
  subcode `retired_active_profile_header`, because the request now names the tax
  ID in the `{company}` segment. Replacements: the tax IDs of the account are
  `public-api.v1.companies.list` and `public-api.v1.companies.create` under
  `/v1/accounts/{account}/companies` (switch them on and off with
  `public-api.v1.companies.activate` and `public-api.v1.companies.deactivate`);
  the seat is the **additional NIF**, priced by
  `public-api.v1.companies.seat_charge_preview`, with the errors
  `gestoria_module_required` → `additional_nif_not_in_plan`,
  `gestoria_plan_required` → `additional_nif_plan_required` and
  `seat_charge_failed` → `additional_nif_charge_failed`; a client you provision
  is a **managed account** (`public-api.v1.managed_accounts.create`); a client
  that already has an account grants **access** from the web app, which has no
  API route; a key limited to some tax IDs is issued with `scoped_company_ids` in
  `public-api.v1.account.api_keys.create`. `public-api.v1.gestoria.workforce_summary`
  was not removed: it moved to `GET /v1/accounts/{account}/gestoria/workforce-summary`.
- **The root provisioning routes are not re-anchored.** `GET`/`POST /v1/accounts`
  and the three `/v1/accounts/imports…` routes carry no `{account}` and never
  will. Do not "repair" them by inserting your own account id, and in
  `managed-accounts` do not replace `{account}` with it: there it names the
  managed account.

A report may quote the old flat path when it describes **what the code assumed
before** — that is legitimate history. Label it as the previous form; never
write it as a target.

Live signal to look for in the user's logs or a probe request: the
`Deprecation: true`, `Sunset:` and `Link: …; rel="deprecation"` response headers
mark an endpoint already on the way out.

## Step 3 — Diff the SDK version

Compare installed vs latest published. Read the changelog between them and
classify each entry with the same rule. Report the gap even when nothing in it
is breaking — a stale SDK is missing retry, idempotency and pagination fixes.

Both SDKs are `0.x`: the surface is stable and SemVer-protected, but minor
breaking changes can land before `1.0.0`. So for a `0.x` bump, read the
changelog rather than trusting the version arithmetic.

## Step 4 — Classify. Breaking vs additive is not a judgement call

Use the published taxonomy — do not improvise it.

**Breaking** (forbidden inside `/v1`; if you see one, it arrived via a dated
version or a `/v2`):

- renaming or removing a response field;
- changing a field's type;
- changing an existing error's `type`/`code`;
- changing status codes;
- making an optional request field required;
- changing an identifier's format;
- removing an endpoint without a documented replacement and migration window;
- changing document state-machine semantics.

**Additive** (ships without a new version):

- new response fields, new optional request parameters, new endpoints;
- relaxed restrictions (higher limits, more accepted formats);
- new enum values on fields that aren't critical to a client state machine;
- improved error **messages** (`message` moves; `type`/`code` don't);
- reclassifying an error's `type` **behind a dated version** — keys pinned to an
  earlier date keep the previous `type` byte for byte, and `code`/`subcode`/status
  never move.

That last one is why **a dated pin changes the answer**: the same published
change is breaking for an unpinned caller and invisible to a pinned one. Always
resolve the user's effective version — the `Factuarea-Version` header if sent,
otherwise the key's pin, otherwise the default — before classifying.

New enum values deserve their own look: additive by policy, but breaking *for
this codebase* if it has an exhaustive `switch` with no default, or a TypeScript
union that no longer matches. Report those as breaking-for-you and say why.

## Upgrading to the template, presentation and business-data contract

This release adds the PDF template library, document presentation and structured
invoice data. Most of it is additive (new operations, new optional fields, two new
scopes `pdf_templates:read` and `pdf_templates:write`, no removed response
fields), but a few things change what existing code sees. The new operations are
born on the company axis — `/v1/companies/{company}/pdf-templates`,
`…/pdf-commercial-identities`, `…/pdf-template-previews`, `…/pdf-artifacts`,
`…/{invoices|quotes|proformas|delivery-notes}/{id}/presentation` and
`…/invoices/{invoice}/administrative-revisions` — and none of them exists at the
root, so code that calls one without `/companies/{company}` gets a `404`. Check
each one against the user's code, with a `file:line`:

| # | What changed | Who it breaks | What to look for |
| --- | --- | --- | --- |
| 1 | `428 pdf_presentation_precondition_required` is **conditional**: when revisioned presentation is active for the company, issue, send, accept and their bulk variants need the seven-field precondition. Accepting a quote or a pro-forma needs it only for the first capture: with a retained capture it is accepted without it, optionally citing `expected_presentation_uuid` (`409 pdf_presentation_conflict` if stale). | Code that issues or sends documents and worked before. | Calls to issue/send/accept without `expected_selection_version`, `expected_source_token`, `expected_preview_context_fingerprint`, `expected_template_revision_id`, `expected_commercial_identity_revision_id`, `purpose`, `format`. Handle `428` by previewing the draft and retrying with the fresh values; in bulk, read `failures[]`. Without the feature active the same fields are **ignored** and the call behaves as before (no `428`, no `422`), so existing code keeps working; with it active they are validated and all-or-none. |
| 2 | The document downloads (`GET .../pdf` of invoices, quotes, pro-formas and delivery notes) can return `202` (JSON with `pdf_output_state` and `Retry-After`, also when a failed render that can be retried is claimed again) and `304`, plus `410`, `409` (`pdf_presentation_conflict` or `pdf_presentation_context_changed`, and for invoices also `pdf_legal_source_changed`) and a terminal `500` with its PDF code (`pdf_original_unavailable`, `pdf_original_corrupt`, `pdf_original_layout_unavailable`, `pdf_engine_profile_unavailable`…); rendering an artifact that no render can complete answers that `500` instead of `200` with `state: failed`; `GET /v1/companies/{company}/pdf-artifacts/{artifact}/download` answers `200`, `304`, `410` and `503 pdf_artifact_not_ready` with `Retry-After`, a `503` that previews, `prepare`, `render`, the document downloads and `pdf-link` also return while another request prepares the same PDF. | Code that saves the response body of `GET .../pdf` as a file. | A `202` body written to disk as a "PDF". Handle 200/202/304, 409, 500 and 503, honour `Retry-After`, send `If-None-Match`, stop on `410` and on the terminal `500` codes. In the PHP SDK predating the contract the `202` raises `APIException`. |
| 3 | **Node `pdf()` returns a union.** `invoices.pdf`, `quotes.pdf`, `proformas.pdf` and `deliveryNotes.pdf` return `BinaryOrJsonResponse` (`kind`: `binary`, `json`, `not_modified`) instead of `BinaryResponse`. | TypeScript callers of those four methods (compile error, or a silent `202` body treated as bytes). | Every `.pdf(` call: branch on `res.kind`. |
| 4 | **Node request bodies are typed** per operation (`body?: PublicApiV1<Op>Data["body"]`), not `unknown`. | TypeScript code that passed loosely shaped bodies. | New compile errors after the bump: fix the body to the spec shape; do not cast to `never`/`any` to silence them (that hides a real mismatch). |
| 5 | `signed_at` on `POST /v1/companies/{company}/delivery-notes/{delivery_note}/sign` is **deprecated and ignored**: the server sets the signature time. `signed_by` is at most 120 characters. | Integrations that send a client-side signature date. | Remove `signed_at`; read the signature time from the response. The deprecated field no longer appears in the API reference. |
| 6 | `pdf_presentation_not_ready` is a **`422`** (a business-rule state of the company, never `403`). | Code that treats it as a permission failure (`403`). | Branch on `error.code`, accept `422`; it means the company has not activated revisioned presentation, so do not retry in a loop. |
| 7 | `PATCH .../public-link` with `action: "publish"` **requires `publication_context`** (`presentation_id` + `expected_binding_version`, from the document's `presentation` block); the other actions reject it. The URL of one exact version is `publication.public_url` from `GET`, valid only when `publication.state` is `ready`; the link's `url`, without a version selector, opens the latest version shared publicly. | Code that publishes public links of invoices, quotes, pro-formas and delivery notes. | `publish` calls without the context, and any code that builds a public URL by hand. |
| 8 | `pdf_output_state` and `presentation` appear on invoices, quotes, pro-formas and delivery notes. `FaceSubmission.status` becomes a closed set that gains `prepared` and `transmission_uncertain` (with `409 face_transmission_uncertain`); FACe `submit` answers `200` for a continued or replayed attempt besides `201`, and `502` is documented. | Exhaustive `switch` / union types on statuses (breaking-for-you, per step 4); FACe retry logic; clients that expect only `201`. | A status switch with no default; a `200` treated as an error; a FACe submit retried after a timeout or `502`. Keep `attempt_id` and never resubmit blindly (the PHP SDK predating the contract still retries `5xx` unless `NoRetry::options()` is passed). |
| 9 | Update bodies distinguish **omitted** from `null`. New optional keys (`pdf_template_id` with `expected_selection_version`, `payment_terms` with `expected_payment_terms_version`, `administrative_centres`, `business_references`, `invoicing_period`, `legal_literals`) keep their value when absent and clear it when `null` (`payment_terms: null` removes the schedule of a draft only; `[]` means explicitly none). | Code that serializes a full model with `null` for unset fields on `PUT`/`PATCH`. | Any serializer that turns "unset" into `null` (in PHP check the body the generated SDK emits). |
| 10 | Customer profile: the four DIR3 codes, `dir3_proponent` included, follow one omission rule; sending the profile without a code clears it. | Code that updates the customer profile with a subset. | Send all four codes you want to keep every time. |
| 11 | `Idempotency-Key` is **required** on four new operations (previews, prepare, render, asset upload). | Raw-HTTP callers. | `422 idempotency_key_required`. The SDKs add the key automatically. |
| 12 | Three list families are **offset** lists, unlike every other cursor list: `GET /v1/companies/{company}/pdf-templates`, `GET /v1/companies/{company}/pdf-commercial-identities` (items under `items`) and the four `.../presentation-history` (items under `data`) take `page` / `per_page` and return `meta: { page, per_page, total }`. | Code that feeds every list to a cursor iterator, or assumes `has_more`. | A cursor loop over these lists never terminates or stops after the first page. |
| 13 | The presentation fields (`pdf_template_id` with `expected_selection_version`, `presentation_precondition(s)`, `presentation_policy` with `expected_presentation_policy_version`) are **ignored** while the company has not activated revisioned presentation, and validated once it has. `payment_terms` and `payment_terms_template` are not presentation fields: they are always validated. | Code that reads a `422` into the presentation fields on a company that never activated the feature. | Do not add a `422` branch for them on an inactive company; assuming the opposite is the bug. |
| 14 | An invoice with a non-empty `payment_terms` falls due on its **last instalment**: issuing it (`POST /v1/companies/{company}/invoices/{invoice}/issue`, or a create that issues it), scheduling it (`POST /v1/companies/{company}/invoices/{invoice}/schedule`) or rescheduling it (`PATCH /v1/companies/{company}/invoices/{invoice}/reschedule`) with a `due_on` that is missing or different answers `422 invoice_due_date_not_last_instalment`, and nothing changes. A draft still stores another date, and an update that replaces `payment_terms` without `due_on` takes the last instalment's date. Duplicating an invoice dates the copy today and moves each instalment by the days between both issue dates, keeping its amount; `due_on` becomes the last moved instalment. | Code that sets `due_on` from its own payment rule (invoice date plus N days) and also sends an instalment schedule; code that duplicates an invoice and assumes its instalment dates are copied as they were. | Derive `due_on` from the last instalment, or omit it when replacing the schedule on an update; handle the new `422` on issue, schedule and reschedule; read the dates of a duplicated draft back instead of reusing the original ones. |

Also additive: Facturae export of a non-draft invoice without a payment schedule
omits the due-dates block (same as before), and the library, preview, artifact
and presentation operations are new (no existing call changes). The inventory of
operations and schemas comes from the live spec, not from this table: run the
diff of steps 1 to 3 and use this list to know which differences matter.

SDK method names for the new operations exist only in versions regenerated from
the published spec; if the pinned SDK lacks them, say so and cite the operation as
`METHOD /path` rather than inventing a method. Announcement of the change:
<https://docs.factuarea.com/changelog>.

## Step 5 — The report

Group by class, breaking first, and inside each group order by dependency: what
must change before the SDK bump, then the bump, then what only compiles after it.

```
BREAKING (apply first)
1. [src/billing/invoices.ts:88] Reads `invoice.total_amount`, absent from the live
   spec; the field is `total`. → Rename at the read site and in the persisted mapping.
2. [src/billing/client.ts:12] Pinned SDK 0.1.0; latest is 0.3.1. Changelog 0.2.0
   renames `client.invoices.find` to `client.invoices.get`. → Update call sites
   (3: lines 88, 140, 205), then bump.

ADDITIVE (safe, adopt when convenient)
3. [—] `invoices.list` accepts a new optional `verifactu_status` filter; the current
   client-side filtering in reports.ts:44 can be pushed to the API.

ORDER
1 → 2 → verify against sandbox → 3
```

Each entry: location, what drifted, the classification, and the concrete edit.
"Update your SDK" is not an entry — name the calls that change.

## Step 6 — Verify before it's done

Say this explicitly in the report:

1. Point the integration at a `fact_test_` key and exercise the changed paths in
   the **sandbox** first — external effects are off there.
2. If the user was unpinned and the drift bit them, have them **pin
   `Factuarea-Version`** to a known-good date so the next change is scheduled work
   rather than an incident, then move the pin deliberately.
3. Re-run the changed flows and confirm the fields now read are the ones the spec
   declares.

If you could not reach the live spec or the registry, **say so and stop**. A
drift report built from memory is worse than none — it will name fields that were
renamed years ago or miss the one that broke them.

## Documentation (source of truth)

- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json> — **root route**: it describes the whole v1 surface, so it takes no `/companies/{company}` segment
- Versioning & deprecation policy: <https://docs.factuarea.com/guides/versioning>
- Changelog: <https://docs.factuarea.com/changelog/launch> ·
  account model: <https://docs.factuarea.com/changelog/account-model>
- Account model: [accounts and tax IDs](https://docs.factuarea.com/guides/accounts-and-nifs) ·
  [additional tax IDs](https://docs.factuarea.com/guides/additional-nifs) ·
  [managed accounts](https://docs.factuarea.com/guides/managed-accounts)
- SDKs: <https://docs.factuarea.com/sdks>
  ([TypeScript](https://docs.factuarea.com/sdks/typescript) ·
  [PHP](https://docs.factuarea.com/sdks/php))
- Errors: <https://docs.factuarea.com/guides/errors> ·
  every code: <https://docs.factuarea.com/guides/errors/all>
