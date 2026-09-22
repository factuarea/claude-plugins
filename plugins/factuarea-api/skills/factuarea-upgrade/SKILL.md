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

Two shapes of drift are live right now and turn up in almost every report.
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
- Changelog: <https://docs.factuarea.com/changelog/launch>
- SDKs: <https://docs.factuarea.com/sdks>
  ([TypeScript](https://docs.factuarea.com/sdks/typescript) ·
  [PHP](https://docs.factuarea.com/sdks/php))
- Errors: <https://docs.factuarea.com/guides/errors> ·
  every code: <https://docs.factuarea.com/guides/errors/all>
