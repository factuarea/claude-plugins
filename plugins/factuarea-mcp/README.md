# factuarea-mcp

Connects [Claude Code](https://claude.com/claude-code) to the
**[Factuarea](https://factuarea.com) MCP server** — the Factuarea public API
exposed as tools for invoicing, quotes, pro-formas, delivery notes, transport
control documents (DeCA), recurring & purchase invoices, contacts — customers and
suppliers are roles of one contact — products, price lists, document series,
taxes, VeriFactu (AEAT), tasks and projects, and webhooks for Spanish companies.

The plugin ships two things:

- the **MCP server** declaration (`https://mcp.factuarea.com`, HTTP
  transport), so Claude can call Factuarea tools directly; and
- a **skill** that gives Claude the context to use them well — scopes, cursor
  pagination, UUID v7 identity, the error envelope, and test (sandbox) mode.

## Install

In Claude Code:

```text
/plugin marketplace add factuarea/claude-plugins
/plugin install factuarea-mcp@factuarea
```

`/plugin marketplace add` registers this catalog; `/plugin install` installs the
plugin from it. To update later, run `/plugin marketplace update factuarea`.

## Connect the server

The plugin declares the server **without an auth header**, so the recommended
path is OAuth:

1. Run `/mcp`, pick **factuarea**, choose **Authenticate**.
2. Approve in the browser — Dynamic Client Registration + PKCE are automatic. On
   the consent screen you **select the company and the environment** (live or
   test) and the scopes to grant.

Prefer to use your own API key instead? Connect with a static header:

```bash
claude mcp add --transport http factuarea https://mcp.factuarea.com \
  --header "Authorization: Bearer fact_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

The canonical endpoint is the root `https://mcp.factuarea.com`; the older
`https://mcp.factuarea.com/mcp` keeps working as a compatibility alias.

Use a `fact_test_` key for the isolated sandbox (external effects off).

## Use it

Once connected, just ask Claude to work with your Factuarea data — "list this
quarter's unpaid invoices", "create a draft invoice for Acme S.L.", "check the
VeriFactu chain", "add a webhook endpoint", "list the tasks assigned to me this
week", "prepare the DeCA for tomorrow's delivery notes". The skill loads
automatically to guide those calls; you can also invoke it manually:

```text
/factuarea-mcp:factuarea-mcp
```

## What the skill knows

- **Connecting** via OAuth (consent with company + environment selection) or an
  API key header.
- **Channel policy** — an API key with scope `*` reaches **664 tools**; OAuth reaches
  **540**, because **124** sit behind scopes the consent catalog never grants —
  account and credential administration, account
  webhooks and request logs, `verifactu:write`,
  connected stores, workforce actions taken on someone's behalf, and
  irreversible operations such as `delivery_notes:gdpr_forget` or
  `automations:delete`. Managed-account tools need the privileged scope
  `accounts:*`, which `*` does not cover and OAuth never grants, and the
  account-administration tools need their own scopes too; bulk import of managed
  accounts has no MCP tool.
- **41 tool domains** with their tool counts, OAuth reach and scopes — tasks and
  projects (deleting them is API-key only), users, notifications, the agenda and
  the PDF template library among them — plus which tools also need a plan module
  and how feature flags further narrow what's listed.
- **Discovery** — the tools you get come from `tools/list` (scopes, plan and
  modules), never from a fixed list.
- **PDF templates and presentation** — the template, brand, preview and artifact
  tools (`pdf_templates:read` / `pdf_templates:write`, previews also `pdfs:read`),
  the public link that follows the latest shared version or pins one,
  assets as base64 (REST uses multipart), versions as `expected_version`, the `428`
  presentation precondition, `412`/`409` recovery, pending PDFs with `Retry-After`,
  `idempotency_key` on irreversible tools and no blind FACe retries.
- **Transport control documents (DeCA)** — what the DeCA is (not a delivery
  note, an invoice or a VeriFactu record), its lifecycle (draft, issued,
  closed, cancelled, superseded; modifying an issued one adds a version), and
  the irreversible tools that need the user's confirmation.
- **Identity** — opaque `id` (UUID v7), foreign keys as `*_id`.
- **Cursor pagination** — `{ data, has_more, next_cursor }`, no page numbers
  (the template, brand and presentation-history lists are offset lists with
  `page` / `per_page`).
- **Errors** — a failure inside a tool comes back as a result with
  `isError: true` and the REST error contract in `_meta["com.factuarea/error"]`
  (`code`, `http_status`, `hint`, `param`, `subcode`, `details`); the checks that
  run before the tool answer a JSON-RPC error with the same `code` in
  `error.data`. Then `insufficient_scope`, `module_not_in_plan`, `422`
  business-rule violations, `422 idempotency_key_reused`, `409` stale versions
  and `429` with `Retry-After`.
- **Test mode** — the `fact_test_` prefix / test OAuth grant points at an
  isolated sandbox with external effects switched off.

## Resources

- MCP docs: <https://docs.factuarea.com/mcp> — connect · authentication · tools ·
  scopes · errors · test-mode
- PDF templates: [library](https://docs.factuarea.com/guides/document-templates) ·
  [previews and artifacts](https://docs.factuarea.com/guides/pdf-template-previews) ·
  [presentations](https://docs.factuarea.com/guides/document-presentations) ·
  [invoice business data](https://docs.factuarea.com/guides/invoice-business-data)
- Docs home: <https://docs.factuarea.com>
- Dashboard / API keys: <https://app.factuarea.com/settings/developers/api-keys>
- Contact: `info@factuarea.com`
- MCP server repository: <https://github.com/factuarea/factuarea-mcp>

## License

[MIT](../../LICENSE)
