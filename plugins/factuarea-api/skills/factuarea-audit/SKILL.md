---
name: factuarea-audit
description: Review Factuarea integration code that is **already written** — the user's own repository — against the Factuarea contract, and report defects with a severity, a `file:line` and a concrete fix. Use this when the user asks to audit, review, sanity-check or security-check an existing Factuarea integration, or before it goes to production. Checks seven rule families: webhook signature verification, idempotency on writes, API-key exposure, error handling by `code`, rate-limit handling, document lifecycle, and conditional writes, PDF downloads and URLs, plus a CE01 to CE25 checklist of the PDF template client flows. Reviews source code in a repository — not for operating the user's account through MCP tools (that is `factuarea-mcp`); not for writing a new integration (`factuarea-implement`); not for implementing the webhook receiver itself (`factuarea-webhooks`); not for realigning code after a spec or SDK change (`factuarea-upgrade`).
---

# Auditing a Factuarea integration

You are reviewing **the user's code**, not Factuarea's. The deliverable is a list
of findings, each one actionable on its own.

## How to run the audit

1. **Locate the integration surface.** Find where Factuarea is called and where
   it calls back:
   - dependency on `@factuarea/sdk` or `factuarea/factuarea-php`;
   - HTTP calls to `api.factuarea.com`;
   - literals `fact_live_`, `fact_test_`, `whsec_`;
   - route handlers referencing `Factuarea-Signature` or `Factuarea-Event-Id`.

   Then find the receiver **by its route, not by its headers**: search the route
   table and file names for `webhook`, `hook`, `callback`, `notify`, and read every
   handler you find. A receiver that never verifies anything references no
   `Factuarea-*` header at all, so header-based search is blind to exactly the
   worst case — the one you are here to catch. Same for the SDK: a hand-rolled
   integration has no dependency to grep for.
2. **Read those files.** Do not guess from file names. A finding must cite a line
   you actually read.
3. **Apply the seven families below.** Each rule states when it fires **and when it
   must not** — check the exemptions before reporting.
4. **Report.** Findings ordered by severity, then a one-line summary of what was
   checked and found clean.

## Finding format (mandatory)

Every finding has all five fields. A finding without a location is not a finding.

```
[FCT-WH-001] CRITICAL — src/routes/webhooks.ts:14
The webhook handler processes the payload without verifying `Factuarea-Signature`,
so anyone who knows the URL can post a forged `invoice.paid`.
Fix: verify first — `const event = verifyWebhook(rawBody, req.header("Factuarea-Signature"), process.env.WHSEC)`
inside a try/catch that returns 400; capture rawBody with `express.raw({ type: "application/json" })`.
```

**Severity:**
- **CRITICAL** — credential exposure, or unauthenticated writes into the user's system.
- **HIGH** — silent data corruption: duplicated documents, lost deliveries, corrupted fiscal records.
- **MEDIUM** — breaks on a contract change, under load, or on a retry.
- **LOW** — works, but fragile or against the documented grain.

Never report a generic diagnosis ("consider reviewing your error handling").
If you can't point at a line, you don't have a finding — say the area is clean
or that you couldn't inspect it, and why.

---

## Family 1 — Webhook signature verification

### FCT-WH-001 · CRITICAL · No signature verification

**Fires when** a route handles a Factuarea webhook and no code path verifies
`Factuarea-Signature` before the payload is acted on — no `verifyWebhook`, no
`WebhookVerifier`, no `hmac`/`hash_hmac` over the body.
**Does not fire when** verification happens first via an SDK verifier, a manual
HMAC, or a shared middleware applied to that route (follow the middleware to
confirm it actually runs on this path).
**Fix:** verify as the first statement; return `400` on failure.

### FCT-WH-002 · CRITICAL · Signature computed over a re-serialized body

**Fires when** the HMAC input is a parsed object re-serialized (`JSON.stringify(req.body)`,
`json_encode($request->all())`) instead of the raw bytes.
**Does not fire when** the code uses `req.rawBody` / `express.raw` / `await req.text()` /
`$request->getContent()` / `request.get_data()`.
**Fix:** capture the raw body before body-parsing middleware and HMAC that.
Symptom if unfixed: every signature fails once payload key order changes.

### FCT-WH-003 · HIGH · Non-constant-time signature comparison

**Fires when** the computed and received signatures are compared with `==`, `===`,
`!=` or `strcmp`.
**Does not fire when** using `crypto.timingSafeEqual`, `hash_equals`,
`hmac.compare_digest`, or an SDK verifier.
**Fix:** swap in the constant-time comparison for the language.

### FCT-WH-004 · HIGH · Only one `v1` value parsed

**Fires when** the header is parsed into a key→value map, or with a regex that
captures a single `v1`, so a second `v1` is discarded.
**Does not fire when** every `v1` is collected into a list and the code accepts if
any matches, or an SDK verifier is used.
**Fix:** collect all `v1` values; accept on any match.
Symptom if unfixed: **deliveries are rejected for 24 h after every secret
rotation** — the header carries `t=…,v1=<current>,v1=<previous>` during the grace
window.

### FCT-WH-005 · MEDIUM · No timestamp tolerance

**Fires when** `t` is never compared against the current time.
**Does not fire when** a tolerance (±300 s is the documented default) is enforced,
or an SDK verifier is used.
**Fix:** reject when `|now - t| > 300`. Without it, a captured delivery replays forever.

### FCT-WH-006 · HIGH · Failed verification answers 2xx

**Fires when** the handler returns `200`/`204` (or falls through to a default 200)
after a verification failure.
**Fix:** return `400`. A 2xx tells Factuarea the delivery succeeded, so it is
never retried — a real event is lost.

### FCT-WH-007 · HIGH · No deduplication, or dedup on the wrong id

**Fires when** the handler has side effects and never checks whether the event was
already processed, **or** dedups on `Factuarea-Delivery-Id` (which changes on every
attempt, so it never matches).
**Does not fire when** dedup keys off `Factuarea-Event-Id`, the `Idempotency-Key`
header (same value), or the body's `id`, backed by a uniqueness constraint.
**Fix:** persist processed event ids with a unique constraint; short-circuit with 200.

### FCT-WH-008 · MEDIUM · Heavy work before the acknowledgement

**Fires when** the handler renders documents, calls third parties or sends email
inline before responding.
**Fix:** record, respond `2xx`, process in a queue. Otherwise the delivery times
out and is retried while the first run is still in flight.

---

## Family 2 — Idempotency on writes

### FCT-IDEM-001 · HIGH · Mutating request without `Idempotency-Key`

**Fires when** a `POST`/`PATCH`/`PUT`/`DELETE` to `api.factuarea.com` is issued over
**raw HTTP** (`fetch`, `axios`, `curl`, Guzzle, `requests`, `http.Client`) with no
`Idempotency-Key` header.
**Does not fire when** the call goes through an official SDK — `@factuarea/sdk` and
`factuarea/factuarea-php` attach an `Idempotency-Key` to every mutating request
automatically and reuse it across retries. Reporting SDK calls here is a false
positive; check which client is in use before reporting.
**Fix:** send `Idempotency-Key: <stable key>` — a UUID per logical operation, or your
own natural key (`order-4711`) when you have one. Symptom if unfixed: a timeout plus
a retry creates the invoice **twice**, and the second one is a real fiscal document.

### FCT-IDEM-002 · MEDIUM · Idempotency key reused across different payloads

**Fires when** one key is derived from something coarser than the payload (a constant,
a date, a customer id) and reused for genuinely different requests.
**Fix:** one key per logical operation; reuse it **only** for retries of that same
call. Reuse with a different body returns `422 idempotency_key_reused`; a retry
that overlaps the first request still running returns `409 idempotency_key_in_use`.

### FCT-IDEM-003 · MEDIUM · Retries that regenerate the key

**Fires when** a retry wrapper generates a fresh key on each attempt (key created
inside the retry loop).
**Fix:** compute the key once, outside the loop. A regenerated key defeats the
entire mechanism — each attempt is a new create.

---

## Family 3 — API key security

### FCT-KEY-001 · CRITICAL · API key reachable by the browser

**Fires when** a `fact_live_…`/`fact_test_…` literal, or a client-exposed env var
holding one (`NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`, `EXPO_PUBLIC_*`), appears in
code that runs in a browser or mobile client — React/Vue/Svelte components, anything
under a client bundle, `"use client"` files, inline `<script>`.
**Does not fire when** the key is read from a server-only environment variable in
server-side code (Node server, API route/handler, Laravel controller, serverless
function, worker).
**Fix:** delete the key from client code and **rotate it immediately — it must be
considered compromised**. Move the call to your backend and have the client call
your own endpoint. The Factuarea API is server-to-server; there is no browser-safe
key. Report this even if the key looks like a placeholder, and even if it's a
`fact_test_` key: sandbox keys are still credentials.

### FCT-KEY-002 · CRITICAL · Credential committed to the repository

**Fires when** a `fact_live_`/`fact_test_`/`whsec_` literal appears in a tracked file —
source, `.env` that isn't ignored, fixture, README, test snapshot, CI config.
**Does not fire when** the value is an obvious redaction (`fact_live_xxxxx`, `…`) used
as documentation.
**Fix:** rotate the credential, remove it from the working tree, and purge it from
history if it was pushed. Rotating without purging leaves it readable in the log.

### FCT-KEY-003 · MEDIUM · Environment chosen by a flag instead of the key prefix

**Fires when** the code selects live vs sandbox with its own boolean/flag/base-URL
switch rather than by which key it loads.
**Fix:** the prefix **is** the environment — `fact_test_` → sandbox, `fact_live_` →
production. A separate flag desynchronizes from the key and writes real documents
while the code believes it is in test.

### FCT-KEY-004 · MEDIUM · Key or webhook secret logged

**Fires when** the key, the `Authorization` header or `whsec_…` reaches a logger,
an error report, or an exception message.
**Fix:** redact before logging. Log `request_id` instead — that's what support needs.

---

## Family 4 — Error handling by `code`

### FCT-ERR-001 · MEDIUM · Branching on the error message

**Fires when** control flow tests `error.message` (`includes`, `str_contains`, regex,
equality) instead of `error.code`.
**Fix:** branch on `error.code`. `message` is human text **in Spanish** and may be
re-worded or localized at any time; `code` is the stable contract. A `message`
comparison silently stops matching and the branch goes dead.

### FCT-ERR-002 · MEDIUM · Branching on HTTP status alone where the status is ambiguous

**Fires when** a `409` or `422` is handled generically, so distinct conditions
collapse into one branch — e.g. a duplicate, an idempotency conflict and a lock are
all `409`, and a validation failure and a business-rule violation are both `422`.
**Fix:** switch on `error.code` inside the status.

### FCT-ERR-003 · MEDIUM · Only the first validation error surfaced

**Fires when** a `422` is handled by reading `error.message`/`error.param` only,
while `error.errors[]` (one item per failing field) is ignored.
**Fix:** iterate `error.errors[]` so the user fixes every field in one pass.

### FCT-ERR-004 · LOW · `request_id` not logged on failure

**Fires when** errors are logged without `error.request_id`.
**Fix:** include it. It's the only handle support can trace.

---

## Family 5 — Rate limits

### FCT-RATE-001 · MEDIUM · `429` retried without honouring `Retry-After`

**Fires when** a `429` is retried immediately, on a fixed sleep, or on a backoff that
ignores the `Retry-After` header.
**Does not fire when** the code sleeps for `Retry-After`, or delegates to an SDK
(both official SDKs back off for you).
**Fix:** wait `Retry-After` seconds. Hammering extends the throttle.

### FCT-RATE-002 · MEDIUM · `429` treated as a hard failure

**Fires when** a `429` aborts the operation or surfaces to the end user as an error.
**Fix:** it's a transient signal — retry after the delay.

### FCT-RATE-003 · LOW · Bulk loop with no pacing or budget awareness

**Fires when** an unbounded loop fires per-item requests while
`X-RateLimit-Remaining` is available on every response and unused.
**Fix:** use the bulk operations where they exist, or pace against the remaining
budget.

---

## Family 6 — Document lifecycle

Issued documents are fiscal records under Spanish law. This family catches code
that treats them as ordinary mutable rows.

### FCT-DOC-001 · HIGH · Editing or deleting an issued document

**Fires when** code updates or deletes an invoice that is past `draft` in order to
change amounts, lines, dates or recipient.
**Fix:** an issued invoice is corrected with a **rectificativa** (corrective
invoice), never edited or deleted. See
[Annul vs correct](https://docs.factuarea.com/guides/annul-vs-correct).

### FCT-DOC-002 · HIGH · State changed by writing the status field

**Fires when** a transition is performed by `update`-ing a `status`/`state` field
instead of calling the operation that names the transition (send, mark as paid,
void, accept, convert, sign).
**Fix:** call the named transition. Writing the field skips the business rules,
the audit trail and the VeriFactu/AEAT side effects that the transition triggers.

### FCT-DOC-003 · MEDIUM · Invalid transition treated as a bug instead of a state

**Fires when** a `422`/`409` on a transition is logged as an unexpected error and
retried, rather than handled as "the document is not in a state that allows this".
**Fix:** branch on `error.code` and reconcile by fetching the document.

### FCT-DOC-004 · MEDIUM · Document identity assumed to be an integer or a number

**Fires when** an `id` is parsed as an integer, incremented, sorted numerically, or
stored in an integer column.
**Fix:** ids are **opaque UUID v7 strings**. Store them as strings and pass them back
unchanged.

### FCT-DOC-005 · MEDIUM · Pagination by page number

**Fires when** listing uses `page`/`offset`/`per_page` arithmetic, or stops when a
page returns fewer items than requested.
**Does not fire when** the list is one of the offset lists the contract declares:
`GET /v1/companies/{company}/pdf-templates`,
`GET /v1/companies/{company}/pdf-commercial-identities` and the four
`.../presentation-history`. Those take `page` and `per_page` and return
`meta.total`; looping on `has_more` there is the defect.
**Fix:** cursor pagination only — loop on `has_more`, passing `next_cursor` as
`starting_after`. There are no page numbers in any other list; page arithmetic
silently returns partial data.

---

## Family 7 — Conditional writes, PDF downloads and URLs

Applies to code that touches the PDF template library, document presentation,
PDF downloads, public links, invoice business data or FACe. Skip it (and say so)
when the integration uses none of them. All of these operations live on the
company axis (`/v1/companies/{company}/…`): a raw call without that segment is a
`404`, not a missing feature, so fix the path before judging anything else.

### FCT-COND-001 · HIGH · `null` sent without the intent to clear

**Fires when** a `PUT`/`PATCH` body is built from a full model, DTO or serializer
that turns unset fields into `null` (`JSON.stringify` of an object with explicit
`null`s, a PHP model serialized with nulls, a CLI `--data` template with `null`
placeholders), on fields where `null` clears the stored value: `pdf_template_id`,
`payment_terms`, `administrative_centres`, `business_references`,
`invoicing_period`, `legal_literals`, a contact or series template default.
**Does not fire when** `null` is sent on purpose (the user asked to clear or to go
back to inheriting) or the key is omitted when unchanged.
**Fix:** build the body from the changed fields only; use `undefined`/absent for
"keep". Symptom if unfixed: a routine edit wipes the payment schedule, the DIR3
centres or the template choice of every document it touches.

### FCT-COND-002 · HIGH · Precondition not taken from a fresh read

**Fires when** an `If-Match` or `expected_version` / `expected_selection_version` /
`expected_impact_fingerprint` is hard-coded, cached for long, computed locally, or
set to the "next" number, or when the `ETag` is rebuilt, trimmed of its quotes or
taken from a different URL than the one being changed. Also when `412`, `409` or
`428` is handled by retrying the same request, or by retrying with a made-up
version.
**Does not fire when** the value comes from the `GET` (or the previous write
response) of the same resource and a `412`/`409` triggers a re-read before any
retry.
**Fix:** read, send that exact tag or version, and on `412`/`409` re-read and
re-evaluate the intent. Never loop on a stale value.

### FCT-COND-003 · MEDIUM · Delivery without the presentation precondition handled

**Fires when** issue, send or accept calls (single or bulk) have no
path for `428 pdf_presentation_precondition_required` or `409
pdf_presentation_context_changed`, or the seven precondition fields are reused
across documents or after the draft changed, or a visual action (assigning or
revising a presentation, a preview, an artifact) has no path for `422
pdf_presentation_not_ready`.
**Does not fire when** the integration only targets companies without revisioned
presentation: the precondition fields are then ignored and the `428` never comes.
Nor when a quote or pro-forma that already has a retained capture is accepted
without the precondition: that is correct, and the optional
`expected_presentation_uuid` only needs a path for `409 pdf_presentation_conflict`.
**Fix:** preview the saved draft, pass its values per document, re-preview on
`409`, treat `422 pdf_presentation_not_ready` as a company state that no
retry fixes.

### FCT-COND-004 · HIGH · FACe submission retried blindly

**Fires when** `POST /v1/companies/{company}/invoices/{invoice}/face-submissions` (or the SDK/CLI
equivalent) is retried after a timeout, `502 face_transmission_failed`, `500
face_submission_completion_failed` or `409 face_transmission_uncertain`, wrapped in
a generic retry policy, queued for automatic retry, or sent with a freshly
generated `submission_id` each time.
**Does not fire when** the code keeps `error.details.attempt_id`, reads the attempt
and only continues a `prepared` one with the same `submission_id` (that answers
`200`, which is success, not an error).
An SDK that retries `429`/`5xx` by default is a finding too: the PHP SDK needs
`NoRetry::options()` on `submit` and `cancel` until it is regenerated.
**Fix:** no automatic retry on this operation; persist `submission_id` and
`attempt_id`, branch on the attempt's `status`. An uncertain attempt means the
invoice may already be at FACe: a second submission risks a duplicate in the
administration.

### FCT-COND-005 · MEDIUM · `Retry-After` and pending PDFs ignored

**Fires when** a document PDF `202`, or a `503 pdf_artifact_not_ready` (artifact download, preview, `prepare`, `render`, document PDF or `pdf-link`), is retried immediately
or on a fixed sleep, with no attempt bound, or by calling prepare/render again on
every poll; when a `202` JSON body is saved as a PDF; when a `failed` render is
retried with the same `Idempotency-Key`; or when a `500` with a PDF code
(`pdf_original_unavailable`, `pdf_original_corrupt`, `pdf_original_layout_unavailable`,
`pdf_engine_profile_unavailable`, `pdf_payload_resource_unavailable`) is retried
in a loop.
**Fix:** wait `Retry-After` (or `retry_after`), repeat the same `GET` (a document
download claims a retryable failed render again by itself), bound the attempts,
and retry a retryable `failed` artifact once with a new key. Stop on `410` and on
those `500` codes, which no retry fixes.

### FCT-COND-006 · MEDIUM · Public or download URLs reconstructed

**Fires when** a `public_url`, `download_url` or `metadata_url` is built from an id
or a template string, mutated (host or query rewritten), persisted before
`publication.state` is `ready`, or the same URL is stored for a revoked link.
Also when `publish` on a public link omits `publication_context`.
**Does not fire when** the value returned by the API is stored and used unchanged
(or re-read from `GET`).
**Fix:** use the returned value as is; for artifacts call
`GET /v1/companies/{company}/pdf-artifacts/{artifact}/download` with the
`artifact_id`. To share "whatever is current", use the link's `url`: without a
version selector it opens the latest version shared publicly.

### FCT-COND-007 · MEDIUM · Idempotency missing on the mandatory PDF operations

**Fires when** raw HTTP calls `POST /v1/companies/{company}/pdf-template-previews`,
`POST /v1/companies/{company}/pdf-artifacts`,
`POST /v1/companies/{company}/pdf-artifacts/{artifact}/render` or
`POST /v1/companies/{company}/pdf-templates/assets` without `Idempotency-Key`, or
reuses one key with a different body (`422 idempotency_key_reused`, raw body
compared byte for byte).
**Does not fire when** an official SDK or the CLI is used (they add the key).
**Fix:** one key per intention, retries only with the same key and body.

---

## Client flow checklist (CE01 to CE25)

Applies only to an integration that uses the PDF template library, document
presentation, PDF artifacts or the business data of invoices. For every flow the
integration does **not** implement, write "not used" and move on: do not report
the absence of a flow as a defect, and do not ask for fixtures or test accounts
that the user does not have. Each flow is checked **in the user's code** (the
requests it builds, the statuses it handles, what it persists), never by calling
the API. A failed item is a finding `FCT-CE<nn>` with the severity shown and the
usual `file:line`.

| Flow | What the code must do | Severity |
| --- | --- | --- |
| CE01 Library and revision | Publishes a revision with the `expected_version` and `expected_impact_fingerprint` read from `GET .../impact` just before; re-reads after the write; never overwrites a revision or copies fiscal data into a template; does not expect `duplicate` to copy defaults. | MEDIUM |
| CE02 Shared brand | Reads the brand `impact` before publishing a brand revision and previews before publishing; never puts a tax id or bank data in a brand (`422`); treats a foreign asset or pair as `404`; sends `logo_dark_asset_id` / `brand_image_dark_asset_id` only next to the light image they replace, and leaves `dark_background_fallback` (`silhouette` or `plate`) and `brand_size` to the user's choice, knowing a template with `branding.size: inherit` takes the brand's size. | MEDIUM |
| CE03 Defaults and activation | Keeps the literal `ETag` of `GET /v1/companies/{company}/pdf-templates/defaults`, writes with `If-Match` or `expected_version`; never writes `render_activation` (read-only, `422`); handles `409` by re-reading. | HIGH |
| CE04 Contact preference | Addresses the preference by contact, document type and purpose; `template_id: null` clears, omission keeps, an empty string is `422`; reads before it patches. | MEDIUM |
| CE05 Series | Reads and patches `/v1/companies/{company}/series/{series}/pdf-template` with `If-Match` / `expected_version`; sends `pdf_template_id` with `pdf_template_expected_version` on `PATCH /v1/companies/{company}/series/{series}`; handles `428` and `409` by re-reading. | HIGH |
| CE06 Presentation state and history | Reads `GET .../presentation` before changing it; pages `presentation-history` with `page` / `per_page` and `meta.total` (not a cursor); `template_id` null inherits, a UUID selects, with `If-Match` / `expected_selection_version`; an incompatible manual choice (`422`) is shown, not cleared silently. | MEDIUM |
| CE07 Preview | Sends `Idempotency-Key` on `POST /v1/companies/{company}/pdf-template-previews`; never uses an example or unsaved preview as the proof for issue or send (only a `persisted_draft` preview feeds the precondition); waits for a `202` with `Retry-After`. | HIGH |
| CE08 Assets | Uploads logos and images as multipart (`kind` and the file) with an `Idempotency-Key`; reads them with the bytes `Accept`; expects no `public_url` or base64 in JSON; handles `422` for empty, invalid or oversized files. | LOW |
| CE09 Create, issue, convert | Sends `pdf_template_id` omitted, `null` or a UUID on purpose; with presentation active carries the seven preconditions on issue and conversion; refreshes on `409` and never auto-issues or duplicates. | HIGH |
| CE10 References and lines | Treats business references, line references, dates, `sequence` `0`, period, legal literals and custom lists as exact values (order, duplicates, `0`, `null`, strings); lets the server assign line UUIDs; handles `422` for retired, foreign or duplicate UUIDs; maps by UUID, never by label. | MEDIUM |
| CE11 Administrative routing | Reads `GET .../administrative-revisions`, posts a revision with `expected_version`, `reason` and centres; handles `428` (missing) and `409` (stale); never relies on the parent `If-Match`. | HIGH |
| CE12 Payment terms | Sends `payment_terms` omitted, `null` (draft only) or `[]` on purpose, with `expected_payment_terms_version` on an existing schedule; amounts as signed strings with two decimals (`-12.50`), never floats or commas; does not total or fill the bank account itself; with instalments sends `due_on` equal to the last instalment date (or omits it when replacing the schedule on an update) and handles `422 invoice_due_date_not_last_instalment` on issue, schedule and reschedule; after a duplicate, reads the moved instalment dates back instead of reusing the original ones; handles `428`, `409` and `422`. | HIGH |
| CE13 Recurrence | Sends the complete `presentation_policy` (latest or pinned), `payment_terms_template` and `expected_presentation_policy_version`; handles `422` for a partial policy and `422 recurring_presentation_unavailable` (review the configuration before resuming); resumes explicitly, never as a side effect of an update. | MEDIUM |
| CE14 Current XML | Downloads the current Facturae with `GET /v1/companies/{company}/invoices/{invoice}/facturae` without `submission_id`, reads the real MIME type and the `X-Facturae-Sha256` and `ETag` headers, and does not treat a download as a FACe submission. | MEDIUM |
| CE15 FACe | Passes the exact `submission_id` to continue a prepared attempt; treats `201` as new and `200` as continued or replayed; on `502`, `500` or `409` keeps `error.details.attempt_id` and reads the attempt; never retries or mints a new `submission_id` blindly (FCT-COND-004). | HIGH |
| CE16 PDF official, alternative, draft | Chooses `purpose`, `format` and `variant` deliberately; saves a `200` as bytes and never a `202` JSON; handles `409` (`pdf_presentation_conflict` and `pdf_presentation_context_changed` on the four documents, `pdf_legal_source_changed` on invoices), `410`, `422` (a scheduled invoice has no preview) and the terminal `500` PDF codes; does not treat the retained fingerprint as an `ETag` or assume the original lives 24 hours. | HIGH |
| CE17 Prepare, metadata, wait | `POST /v1/companies/{company}/pdf-artifacts` then `GET` metadata then wait `Retry-After` then download, with a bounded number of attempts; a `503` is pending, a `failed` artifact with `error.retryable` gets one new render with a new key, a render that answers `500` with its code is terminal; polling never prepares or renders. | MEDIUM |
| CE18 Public link and selector | Stores `public_url` and `download_url` exactly as returned and only when `publication.state` is `ready`; sends `publication_context` to publish; knows that the link's `url` (no selector) follows the latest shared version while `public_url` pins one; treats `410` as expired or revoked and `404` as private or foreign. | MEDIUM |
| CE19 Payment return | Only if the integration hosts the return page of a public payment: follows the exact URL it was given, confirms the payment, then removes `payment` and `session_id` while keeping the selector; the return URL is never a request field. | LOW |
| CE20 Private signature | Refreshes the delivery note before signing; sends the signature image within the documented limit and `signed_by` of at most 120 characters; does not send `signed_at` (the server sets it); a replay with the same key must not create a second audit; handles `409` and `422`. | MEDIUM |
| CE21 Terminal erasure | After `forget`, reads the retained metadata (`unavailable`), expects `410` privately and `404` publicly, discards any local copy of the derived PDF and never retries to recover personal data. | HIGH |
| CE22 Mail and replay | Sends with the same operation, key and raw body when it repeats; knows that "queued" is not "delivered"; handles `409 pdf_legal_source_changed` and `410`; does not resend blindly after an unconfirmed SMTP outcome. | HIGH |
| CE23 ZIP, quarterly, partial results | Reads the per-row result of bulk operations and the `X-Bulk-*` / `X-Quarterly-*` headers; sends `include_non_invoiced_charges` as present, `false`, omitted or `null` on purpose; never counts a `429` or an infrastructure error as success; retries only the failed ids. | MEDIUM |
| CE24 Legal revision | Previews the `presentation_revision` source, then posts `POST .../presentation-revisions` with `parent_id`, `expected_version`, `expected_source_token`, `expected_preview_context_fingerprint` and `source_policy`; refreshes on `409`; never reuses a revision token to issue. | HIGH |
| CE25 Headers, errors, paging | Literal `ETag` in `If-Match` (`412` before `409`, `428` when missing); `304` without a body means "use your copy"; a replay returns `Idempotent-Replayed`; the same key with another body is `422`; no cache shared across companies; offset lists by `meta`, cursor lists by `has_more`; error statuses handled by `error.code` with `Retry-After` honoured. | MEDIUM |

In the report, list the flows that were checked, the flows marked "not used", and
anything that could not be inspected.

## Reporting

Close with a short summary: which of the seven families and which client flows
(CE01 to CE25) were checked, which were clean, and anything you could not inspect (missing files, generated code,
vendored dependencies) — say so explicitly rather than implying it passed.

If the integration is clean, say that plainly. **An audit that manufactures
findings to look thorough is worse than no audit**: the user stops reading the
output, including the day it matters.

## Documentation (source of truth)

- Webhooks: <https://docs.factuarea.com/guides/webhooks>
- Idempotency: <https://docs.factuarea.com/guides/idempotency>
- Authentication / API keys: <https://docs.factuarea.com/guides/authentication> ·
  <https://docs.factuarea.com/guides/api-keys>
- Errors: <https://docs.factuarea.com/guides/errors> ·
  every code: <https://docs.factuarea.com/guides/errors/all>
- Rate limits: <https://docs.factuarea.com/guides/rate-limits>
- Templates, previews, presentations, business data and FACe: <https://docs.factuarea.com/guides/document-templates> · <https://docs.factuarea.com/guides/pdf-template-previews> · <https://docs.factuarea.com/guides/document-presentations> · <https://docs.factuarea.com/guides/invoice-business-data> · <https://docs.factuarea.com/guides/face-invoicing>
- Pagination: <https://docs.factuarea.com/guides/pagination>
- Annul vs correct: <https://docs.factuarea.com/guides/annul-vs-correct>
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json> — **root route**: it describes the whole v1 surface, so it takes no `/companies/{company}` segment
