# Conditional prefiscal Lead → Opportunity → Activity journey

Run this recipe only under an authorized **test** connection, with each native
tool visible in current discovery and its dependencies available. All identifiers
below are references returned by native reads or original receipts. Placeholder
intent keys stand for a distinct stable key per logical step, not constants to
reuse across unrelated sessions.

## Discover and resolve

Exhaust tools/list `nextCursor`. Resolve `create_lead`, `find_lead`,
`create_opportunity`, `get_opportunity`, `create_crm_activity` and
`get_crm_activity` only when present, then inspect their actual schemas. Resolve
the opportunity's pipeline and stage through visible native read tools in the
same connection. If any step is unavailable, report that dependency and stop
before the affected effect. Do not use `create_client` or customer creation to
stand in for a lead, and do not inject company/environment/scopes into arguments.

## Capture the prefiscal lead

Prepare the requested lead, preserving the owner's current schema. A typical
minimal example when these fields are published is:

```json
{
  "name": "Example prefiscal enquiry",
  "source": "manual",
  "idempotency_key": "<lead-intent>"
}
```

No tax ID, customer role, fiscal counterparty or fabricated entity/effect UUID is
created as a shortcut. Re-discover, dispatch once, retain the original result
and read the returned lead `id` through `find_lead`. A lead conversion is a
separate explicitly reviewed effect using its native preview, version, strategy,
plan hash and confirmation; it is not a prerequisite invented by this recipe.

## Create the opportunity from native references

Prepare only when the current tool accepts the lead reference and the pipeline/
stage reads supplied valid IDs. Keep decimal values as strings:

```json
{
  "title": "Example opportunity",
  "lead_id": "<returned-lead-id>",
  "pipeline_id": "<native-pipeline-id>",
  "stage_id": "<native-stage-id>",
  "amount": "100.00",
  "currency": "EUR",
  "idempotency_key": "<opportunity-intent>"
}
```

Check the actual inputSchema before sending; do not add unsupported fields.
Re-discover and dispatch the approved operation once. Preserve the original
opportunity `id` and read it through `get_opportunity`; keep the current revision
for later CAS operations. Do not infer a customer role from the association.

## Add the native activity

With the requested activity authorized and its native tool available, prepare:

```json
{
  "type": "note",
  "title": "Example follow-up",
  "target": { "type": "opportunity", "id": "<returned-opportunity-id>" },
  "timezone": "Europe/Madrid",
  "idempotency_key": "<activity-intent>"
}
```

Use its current schema, re-discover and dispatch once, then verify the returned
activity `id` through `get_crm_activity`. If a native activity links to a Task,
retain that Task UUID; do not create another task/timer representation.

## Document and ticket continuations

Resolve visible native document candidates before linking an opportunity's
document. Preserve owner `document_id` and revision independently from the
association `link_id`/CAS. A prefiscal Quote continuation uses the visible native
quote-draft recipient contract; it never substitutes for Proposal production or
automatically creates a fiscal customer/invoice.

For customer service stage/attach/detach, first read the ticket and native
document through currently available read tools. Prepare the current ticket
version and native waiting/release evidence, or the document/attachment IDs and
owner revision, exactly as the schema requires. Links do not grant owner access.

## Recovery and evidence

If a current tool disappears or the connection is revoked, leave the next effect
unavailable. Show native 403/404 rather than switching tenant or auth channel.
For CAS 409, read current details and prepare a reviewed new operation. For an
unconfirmed result or lost response, retain the **original** key/payload/references
and reconcile using a visible owner read/recovery tool. If no recovery operation
is available, report that limit and wait; never redispatch automatically.

Record actual host/plugin/server versions, test environment, selected scopes and
returned UUID/revision evidence without tokens or personal data. This is a recipe;
local fixtures do not prove it ran in a host or against a native CRM owner.
