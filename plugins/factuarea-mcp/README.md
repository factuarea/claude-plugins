# factuarea-mcp

Connects [Claude Code](https://claude.com/claude-code) to the
**[Factuarea](https://factuarea.com) MCP server** — the Factuarea public API
exposed as tools for invoicing, quotes, pro-formas, delivery notes, recurring &
purchase invoices, contacts — customers and suppliers are roles of one
contact — products, price lists, document series, taxes, VeriFactu (AEAT) and
webhooks for Spanish companies.

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
VeriFactu chain", "add a webhook endpoint". The skill loads automatically to
guide those calls; you can also invoke it manually:

```text
/factuarea-mcp:factuarea-mcp
```

## What the skill knows

- **Connecting** via OAuth (consent with company + environment selection) or an
  API key header.
- **Channel policy** — an API key reaches the full **470 tools**; OAuth reaches
  **370**, because **100** sit behind scopes the consent catalog never grants —
  account, membership and credential administration, `verifactu:write`,
  connected stores, workforce actions taken on someone's behalf, and
  irreversible operations such as `delivery_notes:gdpr_forget` or
  `automations:delete`.
- **32 tool domains** with their tool counts, OAuth reach and scopes, plus how
  plan/module and feature flags further narrow what's listed.
- **Identity** — opaque `id` (UUID v7), foreign keys as `*_id`.
- **Cursor pagination** — `{ data, has_more, next_cursor }`, no page numbers.
- **Errors** — `insufficient_scope`, `addon_not_active`, `422` business-rule
  violations, `429` with `Retry-After`.
- **Test mode** — the `fact_test_` prefix / test OAuth grant points at an
  isolated sandbox with external effects switched off.

## Resources

- MCP docs: <https://docs.factuarea.com/mcp> — connect · authentication · tools ·
  scopes · errors · test-mode
- Docs home: <https://docs.factuarea.com>
- Dashboard / API keys: <https://app.factuarea.com/settings/developers/api-keys>
- Beta access: `info@factuarea.com`

## License

[MIT](../../LICENSE)
