# Conditional native operation examples

This table identifies native CRM operations to look for. It **does not publish
availability or grant scopes**. Use only a tool present in the current complete
discovery, with its current schema and native owner. OAuth consent uses the
scope names offered by the host/server; examples below are MCP fine scopes.

| Group | Native tools to resolve when visible | Fine scope examples |
| --- | --- | --- |
| Commercial documents: read | `list_commercial_documents`, `get_commercial_document` | `crm_documents:read` |
| Commercial documents: write | `upload_commercial_document`, `replace_commercial_document_version`, `share_commercial_document`, `revoke_commercial_document_share`, `archive_commercial_document` | `crm_documents:write` |
| Opportunity documents: read | `list_opportunity_documents`, `list_opportunity_document_candidates`, `get_opportunity_financial_summary` | `crm_opportunitydocuments:read` |
| Opportunity documents: write | `create_opportunity_quote`, `link_opportunity_document`, `unlink_opportunity_document` | `crm_opportunitydocuments:write` |
| Ticket stage/documents | `move_service_ticket_to_stage`, `attach_service_ticket_document`, `detach_service_ticket_document` | `customer_service:write` |
| Prefiscal lead | `create_lead`, `find_lead`; reviewed conversion only via visible native preview/convert tools | `crm_leads:read`, `crm_leads:write` |
| Opportunity | `create_opportunity`, `get_opportunity`, `list_opportunities` | `crm_opportunities:read`, `crm_opportunities:write` |
| Activity | `create_crm_activity`, `get_crm_activity` | `crm_activities:read`, `crm_activities:write` |

The first five rows describe sixteen operations. A server may expose only a
subset or additional tools; unknown new descriptors remain usable through
discovery, without updating a local catalogue. These examples never substitute
for the connected server, entitlement, record access or owner readiness.

## Payload and result boundaries

- **Commercial documents:** opaque public UUIDs; upload/replace takes a native
  `producer_reference_id` and `claimed_mime`, not fabricated base64/multipart
  arguments. Replace/share/revoke/archive uses current `expected_version`.
  Share grants require actual native grantee IDs and permission. A link does
  not grant access or generate a share URL. No download tool is inferred.
- **Opportunity documents:** parent `id`; candidate `document_type`, `search`,
  opaque `cursor`, `limit` as published. Quote drafts use the closed native
  recipient and expected root/line revisions. Link uses native document type
  and owner `document_id`; unlink uses association `link_id` and association
  `expected_version`. Financial summaries keep currency buckets and decimal
  strings; association revision and document revision are independent.
- **Customer service:** move requires ticket `id`, `expected_version`, pipeline
  and stage IDs. Native waiting/release evidence is used only when the schema
  and current ticket expose it. Attach requires native document ID/version;
  detach requires association `attachment_id`. Do not fabricate waiting facts
  or treat a document link as document-owner authorization.
- **Lead/opportunity/activity:** retain prefiscal identity and the native
  returned references. Opportunity creation uses current pipeline/stage IDs,
  a declared lead/contact reference, decimal amount and currency. Activity
  targets the returned native record. Confirmed lead conversion preserves
  counterparty roles; no client alias or automatic customer promotion.

For every group, read current data before CAS writes, preserve omitted/null
semantics and keep one native intent key. Report native denial/unavailability
or an unconfirmed effect without constructing another owner, status or receipt.
