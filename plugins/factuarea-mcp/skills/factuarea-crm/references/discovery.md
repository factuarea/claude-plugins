# Discovery and host adapter

The plugin already declares `factuarea` in `.mcp.json`. Reuse that connected
client for both discovery and calls. The CRM helper takes two functions:

```js
import { createCrmSession } from '../scripts/crm-session.mjs';

const crm = createCrmSession({
  listTools: (params) => connectedFactuareaClient.listTools(params),
  callTool: (params) => connectedFactuareaClient.callTool(params),
  maxPages: 1000,
});
```

`connectedFactuareaClient` is supplied by the existing host adapter. This is a
binding example, not a second client constructor or an automatically installed
Claude hook. The helper has no HTTP, SDK dependency, token store or OAuth code.
The callbacks must preserve decoded descriptors/results, including unknown
extensions. If a host SDK strips fields during validation, the helper cannot
restore them; document that adapter limitation and verify it in the actual host.
Hosts that do not expose client callbacks follow the skill using their native
MCP facilities; record limitations if those facilities cannot exhaust discovery.

`discover()` walks tools/list with `{}` followed by `{ cursor: nextCursor }`.
Only absence of `nextCursor` finishes the inventory; an empty tools array can
still have another page. Identical duplicate names are deduplicated. A changed
descriptor, invalid cursor, repeated cursor, native error or explicit page
budget fails the whole attempt. Tool extensions are preserved. No partial
inventory becomes a cached grant or a prepared action.

`read(name, arguments)` requires the current descriptor's `readOnlyHint: true`.
`prepareWrite(name, arguments)` produces an immutable client preview with the
actual descriptor, payload and stable native intent key. `executeWrite(preview)`
re-discovers and compares the descriptor, and sends that prepared intent once.
Native validation and confirmation remain in the owner. Responses are returned
unchanged, including `isError` and unconfirmed results. Errors are thrown as the
same objects. There is no retry loop or invented receipt/confirmation API.

Connect `crm.invalidate()` to reconnection, tools/list_changed notifications and
known changes of company, environment, consent or policy. An in-progress walk
and previously prepared actions then fail. Each read and write still discovers
again; notification delivery is not a substitute for current server authority.
Retain original intent details for recovery across host sessions. The helper's
volatile one-shot protection is not an owner effect ledger or durable recovery.

## Business pagination

Discovery uses MCP **nextCursor/cursor**. It does not rewrite any tool's data
pagination. Inspect that tool's schema and response:

- Opportunity documents/candidates use opaque data cursors. Keep filters fixed
  for the traversal and pass the exact returned cursor in the published field.
- A tool that publishes page/per_page uses those fields; commercial-document
  listing currently does. Do not replace them with starting_after.
- A tool that publishes has_more/next_cursor/starting_after follows that exact
  contract. Do not infer its cursor from a record's ID.

Keep the explicit requested limit/page budget visible. If it is reached, label
the result partial instead of reporting a total or claiming traversal completed.
Current field masks and owner ACL remain server decisions for every page.
