---
name: factuarea-webhooks
description: Write or fix the HTTP endpoint in the user's application that receives Factuarea webhook deliveries. Use this when the user is building a webhook receiver, verifying the `Factuarea-Signature` HMAC, deduplicating redeliveries, deciding what to do inside the handler, handling a secret rotation, or testing deliveries locally with `factuarea listen`. Covers the real delivery contract: raw-body HMAC-SHA256, constant-time comparison, the two `v1` values during a rotation grace window, dedup by `Factuarea-Event-Id`, and acknowledging with a fast 2xx. Scoped to the receiver endpoint itself — not for outbound calls to the API (that is `factuarea-implement`); not for a broad review of an integration that is already written (`factuarea-audit`); not for operating the account through MCP tools (`factuarea-mcp`).
---

# Receiving Factuarea webhooks

This skill is for the **inbound** endpoint: the URL the user registers with
Factuarea, which Factuarea `POST`s to when a subscribed event occurs.

Source of truth: [Webhooks guide](https://docs.factuarea.com/guides/webhooks) and
the live spec (<https://api.factuarea.com/v1/openapi.json>, top-level `webhooks`
block). The event catalog is at [Events](https://docs.factuarea.com/guides/events).
Don't invent event types or payload fields — look them up.

## The delivery

Every delivery is a `POST` with a JSON body and these headers:

```http
Content-Type: application/json
Factuarea-Signature: t=1747314060,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
Factuarea-Event-Id: 01931b3e-7c4a-7f2e-9a8b-3c5d6e7f8a0d
Factuarea-Event-Type: invoice.paid
Factuarea-Delivery-Id: 01931b3e-7c4a-7f2e-9a8b-3c5d6e7f8a0c
Idempotency-Key: 01931b3e-7c4a-7f2e-9a8b-3c5d6e7f8a0d
```

- **`Factuarea-Event-Id`** — the event's stable UUID v7. **Identical across every
  redelivery of the same event.** This is your dedup key.
- **`Factuarea-Delivery-Id`** — this *attempt*. Different on every redelivery.
  Use it for logs and support, never for dedup.
- **`Idempotency-Key`** — the industry-standard header, carrying the **same value**
  as `Factuarea-Event-Id`, so you can dedup from a header your stack may already
  understand without parsing the body.
- **`Factuarea-Event-Type`** — e.g. `invoice.paid`.

## Use the SDK verifier if you can

Both official SDKs ship a verifier that already does the constant-time compare,
the timestamp tolerance and the rotation grace. Prefer it over hand-rolled HMAC.

```ts
import { verifyWebhook } from "@factuarea/sdk";
// rawBody MUST be the exact raw string body — not a re-serialized object.
const event = verifyWebhook(rawBody, req.header("Factuarea-Signature")!, process.env.WHSEC!);
```

```php
use Factuarea\Sdk\Custom\Webhooks\WebhookVerifier;
// Throws WebhookSignatureException on any failure.
$event = (new WebhookVerifier())->verify($rawBody, $signatureHeader, getenv('WHSEC'));
```

Any other language → follow the manual recipe below.

## Verification — the five things that must be true

`Factuarea-Signature` is `t=<unix>,v1=<hex>`, where `v1` is
`HMAC-SHA256(secret, "{t}.{raw_body}")` in hex and the secret is the endpoint's
`whsec_…`.

1. **Verify before you process.** Signature check is the first thing in the
   handler. Anything that happens before it — parsing into your domain model,
   touching the database, enqueuing — runs on unauthenticated attacker input.
   A receiver that processes first and verifies later (or not at all) is a
   public write endpoint for anyone who knows the URL.
2. **Sign the raw body, byte for byte.** The HMAC is over the exact bytes
   received. If your framework parsed the JSON and you re-serialize it, key
   order and whitespace change and **every** signature fails. Capture the raw
   body *before* body-parsing middleware:
   - Express: `express.raw({ type: "application/json" })` on the webhook route,
     or `express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })`.
   - Laravel: `$request->getContent()`.
   - Flask: `request.get_data()`.
   - Next.js route handlers: `await req.text()`.
3. **Compare in constant time.** `hash_equals` (PHP), `crypto.timingSafeEqual`
   (Node), `hmac.compare_digest` (Python). `==` on the hex string leaks the
   signature through timing.
4. **Accept if ANY `v1` matches.** During a secret rotation the header carries
   **two `v1` values in the same header** — `t=…,v1=<current>,v1=<previous>` —
   one per active secret. Parse the header by **collecting every `v1` into a
   list**, and accept when any one matches. A parser that splits into a
   key→value map keeps only one of them and will reject half the traffic during
   a rotation. (Some older spec text mentions a `v0=` key for the previous
   secret — that is wrong; the server emits a second `v1=`.)
5. **Check the timestamp.** Reject when `|now - t| > 300` (±5 min). `t` is inside
   the signed string, so it can't be tampered with; without this check a captured
   delivery can be replayed forever.

```php
function verifyFactuareaSignature(
    string $rawBody, string $signatureHeader, string $secret, int $tolerance = 300,
): bool {
    $timestamp = null;
    $signatures = [];                       // note: a LIST, not a map
    foreach (explode(',', $signatureHeader) as $kv) {
        [$k, $v] = array_pad(explode('=', $kv, 2), 2, '');
        if ($k === 't') { $timestamp = (int) $v; }
        elseif ($k === 'v1') { $signatures[] = $v; }
    }
    if ($timestamp === null || $signatures === []) { return false; }
    if (abs(time() - $timestamp) > $tolerance) { return false; }

    $expected = hash_hmac('sha256', $timestamp.'.'.$rawBody, $secret);
    foreach ($signatures as $candidate) {
        if (hash_equals($expected, $candidate)) { return true; }   // constant time
    }
    return false;
}
```

Return **`400`** on a failed verification. Never `200` — that tells Factuarea the
delivery succeeded and it will never be retried.

## Deduplicate by event id

Deliveries are **at-least-once**. The same event will arrive more than once:
after a timeout, a 5xx, a redeploy, or a manual replay. If your handler isn't
idempotent you will double-charge, double-email or double-book.

Key off `Factuarea-Event-Id` (identical to `Idempotency-Key`, and to the `id`
field in the body). Persist processed ids and short-circuit:

```python
event_id = request.headers['Factuarea-Event-Id']
if db.exists('webhook_events_processed', id=event_id):
    return '', 200                      # already handled — acknowledge, do nothing
process(event)
db.insert('webhook_events_processed', id=event_id, processed_at=now())
return '', 200
```

Make the insert the **unique constraint** on that table, so two concurrent
deliveries of the same event can't both pass the existence check.

Do **not** dedup on `Factuarea-Delivery-Id` — it changes on every attempt, so it
never matches and the dedup silently does nothing.

## Acknowledge fast, work later

Respond `2xx` as soon as the delivery is verified and recorded. Any 2xx counts
as success and the body is ignored. Do the real work in a queue/background job.

A handler that renders a PDF, calls a third party or emails inline will exceed
the delivery timeout, get recorded as failed, and be **retried** — so the slow
work runs again while the first one is still running.

**Retry schedule** (8 attempts total: the first plus 7 retries), each with ±10%
jitter: **+1 min → +5 min → +30 min → +2 h → +12 h → +1 d → +3 d**. After the
last failure the delivery is marked permanently failed, and a persistently
failing endpoint is degraded and then disabled.

Because retries span days, **tolerate out-of-order arrival**: `invoice.paid` can
land before `invoice.sent`. Don't build a state machine that assumes delivery
order — reconcile against the resource (fetch it by `id`) when order matters.

## Secret rotation

`POST /v1/webhook_endpoints/{id}/rotate_secret` returns the new secret. For
**24 hours** (`previous_secret_valid_until` in the response) both secrets are
valid and every delivery is signed with both. Zero-downtime rollout:

1. Rotate → get the new secret.
2. Deploy it to your environment.
3. Your handler accepts either `v1` during the window (rule 4 above — the SDK
   verifiers already loop over every `v1`).
4. After the window the old secret is invalid.

If your verifier only reads one `v1`, this window is exactly when it breaks.

## Test locally

```bash
factuarea listen --forward-to http://localhost:3000/webhooks/factuarea
```

It polls your account's events and forwards them to your local endpoint with the
same `Factuarea-Signature` / `Factuarea-Event-Id` / `Factuarea-Event-Type` /
`Factuarea-Delivery-Id` headers. **It signs with its own generated secret**,
which it prints on startup — set that value in your local env, not your
production `whsec_…`. It is a development loop, not a tunnel for production
deliveries.

Also useful against a real endpoint:

- `POST /v1/webhook_endpoints/{id}/test_event` — trigger a delivery on demand.
- `GET /v1/webhook_endpoints/{id}/deliveries` and `…/deliveries/{delivery}` —
  inspect what was actually sent, and the receiver's response.
- `POST /v1/webhook_endpoints/{id}/deliveries/{delivery}/replay` — resend one
  delivery. A replay carries the **same** `Factuarea-Event-Id`, so it is also the
  cheapest way to prove your deduplication works.

## Checklist before you finish

- [ ] Signature verified **first**, over the **raw** body, **constant time**.
- [ ] Every `v1` in the header is considered; a rotation doesn't break it.
- [ ] Timestamp tolerance enforced (±300 s).
- [ ] Failed verification returns `400`, not `200`.
- [ ] Dedup on `Factuarea-Event-Id` with a unique constraint.
- [ ] `2xx` returned before any heavy work; the work is queued.
- [ ] Handler tolerates redelivery and out-of-order events.
- [ ] The signing secret comes from the environment, never from source.

## Documentation (source of truth)

- Webhooks guide: <https://docs.factuarea.com/guides/webhooks>
- Event catalog: <https://docs.factuarea.com/guides/events>
- SDK verifiers: <https://docs.factuarea.com/sdks#verifying-webhooks>
- Live OpenAPI spec: <https://api.factuarea.com/v1/openapi.json> (`webhooks` block)
- Errors: <https://docs.factuarea.com/guides/errors>
