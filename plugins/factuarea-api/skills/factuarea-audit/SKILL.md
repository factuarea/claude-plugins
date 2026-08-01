---
name: factuarea-audit
description: Review Factuarea integration code that is **already written** — the user's own repository — against the Factuarea contract, and report defects with a severity, a `file:line` and a concrete fix. Use this when the user asks to audit, review, sanity-check or security-check an existing Factuarea integration, or before it goes to production. Checks six rule families: webhook signature verification, idempotency on writes, API-key exposure, error handling by `code`, rate-limit handling, and document lifecycle. Reviews source code in a repository — not for operating the user's account through MCP tools (that is `factuarea-mcp`); not for writing a new integration (`factuarea-implement`); not for implementing the webhook receiver itself (`factuarea-webhooks`); not for realigning code after a spec or SDK change (`factuarea-upgrade`).
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
   - route handlers referencing `Factuarea-Signature` or `Factuarea-Event`.

   Then find the receiver **by its route, not by its headers**: search the route
   table and file names for `webhook`, `hook`, `callback`, `notify`, and read every
   handler you find. A receiver that never verifies anything references no
   `Factuarea-*` header at all, so header-based search is blind to exactly the
   worst case — the one you are here to catch. Same for the SDK: a hand-rolled
   integration has no dependency to grep for.
2. **Read those files.** Do not guess from file names. A finding must cite a line
   you actually read.
3. **Apply the six families below.** Each rule states when it fires **and when it
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
call. Reuse with a different body returns `409 idempotency_key_reused`.

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
**Fix:** cursor pagination only — loop on `has_more`, passing `next_cursor` as
`starting_after`. There are no page numbers in this API; page arithmetic silently
returns partial data.

---

## Reporting

Close with a short summary: which of the six families were checked, which were
clean, and anything you could not inspect (missing files, generated code,
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
- Pagination: <https://docs.factuarea.com/guides/pagination>
- Annul vs correct: <https://docs.factuarea.com/guides/annul-vs-correct>
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json>
