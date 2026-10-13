# CRM MCP reconnaissance

Status: source inspection only. No server connection, credential use, installation,
publication, or runtime compatibility check was performed.

## Repository and baseline

- Plugin repository: `factuarea/claude-plugins`, branch `codex/dev2-crm-artifacts`.
- Repository baseline: `374d7c7d192d407f191526437e8105f23258c455` (`main`).
- The repository had no `AGENTS.md` files or CRM plugin package at this baseline.
- Existing repository tooling is `scripts/validate_plugins.py`; there is no root
  `package.json` or test runner to reuse. The CRM package's contract test uses
  Node's built-in `node:test` and has no runtime dependency.

## Backend source inspected

The development checkout was on `feature/dev-2-crm-remote-20261002` at
`73cec2b593288120744df869211793d40697d68a`. Its working tree contains unrelated
local changes, which were left untouched. The CRM MCP source contract is
`integrations/crm/mcp-plugin/NativeCrm134/source-contract.json`; it identifies
source-contract version 1, package version `0.2.0`, and source baseline
`5aa26f14df729dbd8fac7e8017c1f94ed6f1b3d2`. The nine CRM commercial-journey
entries and their source SHA-256 values match the corresponding tool files in
that checkout.

The available source operations are `create_crm_activity`, `create_lead`,
`create_opportunity`, `find_lead`, `get_crm_activity`, `get_opportunity`,
`get_pipeline`, `list_crm_activities`, and `list_pipelines`. Their native fine
scopes are recorded in `plugin-contract.json`. The MCP tools use the existing
Factuarea service at `https://mcp.factuarea.com` over Streamable HTTP and rely
on its existing OAuth consent or bearer API-key authentication. Company
context comes from native consent/current credentials; callers do not choose
or pass a tenant.

## Compatibility and limits

The source descriptor accepts legacy initialize revisions `2025-11-25` and
`2025-06-18`. It rejects the modern `2026-07-28` handshake rather than
downgrading it. The backend also documents modern protocol support, but this
plugin source descriptor does not claim or test that path. The authenticated
server catalog and each current tool call remain authoritative for grants,
tenant, plan, and availability. A source match is not evidence that a tool is
currently exposed to a credential.

The backend source contract marks live discovery unverified, has no observed
server version, and keeps production disabled by package. The contract test
therefore defaults to offline checks; credentialed probes are opt-in and need
an operator-owned sandbox fixture. No live probe was executed for this change.
