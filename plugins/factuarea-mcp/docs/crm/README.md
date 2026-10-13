# Native CRM with factuarea-mcp

The CRM skill uses this plugin's existing **factuarea** MCP connection for leads,
opportunities, activities, commercial documents and customer service. Available
tools and their arguments come from the connected server. The skill never
enables a module, grants access or constructs another document owner.

## Load the reviewed source

The CRM addition is source in this checkout. A released marketplace version may
not contain it yet. For an authorized local review, Claude supports loading the
plugin directory directly:

```bash
claude --plugin-dir /path/to/checkout/plugins/factuarea-mcp
```

Then invoke `/factuarea-mcp:crm <request>` or
`/factuarea-mcp:factuarea-crm`. The standard `skills/` and `commands/` directories
are discovered by the host; no second plugin identity or server declaration is
required. See the [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

For an approved released version, use the existing marketplace procedure:

```text
/plugin marketplace add factuarea/claude-plugins
/plugin install factuarea-mcp@factuarea
/plugin marketplace update factuarea
```

These are review/install recipes, not a claim that a host installation or release
has occurred. Record the actual source commit, plugin and Claude versions when
checking a distribution. No package version has been advanced for this source.

## Authenticate, select context and revoke

In `/mcp`, select **factuarea** and authenticate with the existing host-managed
OAuth connection. Complete its supported browser flow and select the company,
test environment and minimum scopes required for the intended operations.
Claude stores and refreshes the token. The CRM skill does not implement DCR,
CIMD, private_key_jwt, PKCE or a separate token store; support must be checked
against the actual host and server. Do not place keys, tokens or assertions in
the plugin, a prompt, fixture or example.

Use `/mcp` → **factuarea** → **Clear authentication** to clear the stored OAuth
connection, and revoke the connection through Factuarea's native consent controls
when server-side revocation is needed. Reconnect with the intended company and
environment after any change. A cached discovery list never authorizes a call;
discard prepared CRM actions and fetch current discovery. The host's connection,
refresh and clearing behavior is described in
[Claude's MCP documentation](https://code.claude.com/docs/en/mcp).

## Work from the native contract

Start with [the skill](../../skills/factuarea-crm/SKILL.md) and the
[conditional journey](journey.md). Exhaust tools/list **nextCursor**, deduplicate
identical descriptors and reject an incomplete or inconsistent inventory.
Business pagination follows each tool's own schema, including page/per_page
where published; it is separate from discovery cursors.

[Operation examples](../../skills/factuarea-crm/references/operations.md) and
[contract.json](contract.json) describe sixteen document/ticket operations plus
the native Lead → Opportunity → Activity journey. They identify things to look
for, not installed capabilities or OAuth grants. Use only tools actually visible
and executable under the current connection. Read-only consent cannot be upgraded
by a manifest, command, cached descriptor, alias or company ID in arguments.

Keep public UUIDs, native intent keys, current CAS and original receipts.
Quote/financial summaries retain currency buckets and decimal strings. A ticket
attachment and an opportunity association preserve their document owner's
independent version and access rules. Missing owners remain unavailable.

Before send/convert/delete, review the exact native effect and obtain the explicit
confirmation its owner requires. A timeout or unconfirmed response retains the
same intent for owner reconciliation; do not automatically send again, mint a new
key or report success. Surface original native codes and all field errors.

## Local checks and installed-host proof

The helper uses callbacks from an already connected client and has no network or
OAuth implementation. Its local checks use synthetic descriptors/responses and
never contact a real account:

```bash
node --test plugins/factuarea-mcp/tests/crm/crm-session.test.mjs
```

Local tests can verify complete discovery, revocation/descriptor invalidation,
immutable preparation, single dispatch and preservation of errors/results. They
cannot certify user OAuth, native authorization or a commercial effect. Before
claiming installed support, record the actual host/plugin/server versions and:

1. Connect using the server's supported OAuth/CIMD/private_key_jwt and PKCE flow
   with user consent; verify a real currently enabled CRM read/call in test mode.
2. Check read versus write consent, unavailable owners, revocation between steps
   and an inaccessible second-company reference using the native server.
3. Complete the prefiscal Lead → Opportunity → Activity journey without a client
   alias or automatic customer promotion; verify returned IDs using native reads.
4. Exercise multiple discovery/data pages and the native CAS/unconfirmed recovery
   path, retaining original intent and effect references.

Those installed-host checks remain pending until executed with user login and
the required native capabilities. A mocked response or a passing local fixture
does not close them. Use the [Factuarea MCP portal](https://docs.factuarea.com/mcp)
for the published connection and public tool documentation.
