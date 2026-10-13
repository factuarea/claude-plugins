import { readFileSync } from 'node:fs';

/** Synthetic wire descriptors/responses; never a published catalogue or native owner. */
export const UUID = Object.freeze({
  lead: '019fb333-3333-7333-8333-111111111111',
  opportunity: '019fb333-3333-7333-8333-222222222222',
  document: '019fb333-3333-7333-8333-333333333333',
  producer: '019fb333-3333-7333-8333-444444444444',
  ticket: '019fb333-3333-7333-8333-555555555555',
  link: '019fb333-3333-7333-8333-666666666666',
  pipeline: '019fb333-3333-7333-8333-777777777777',
  stage: '019fb333-3333-7333-8333-888888888888',
  activity: '019fb333-3333-7333-8333-999999999999',
});

const uuid = { type: 'string', format: 'uuid' };
const version = { type: 'integer', minimum: 1 };
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const nativeKey = { type: 'string', minLength: 1, maxLength: 255, pattern: '^[ -~]+$' };

export function descriptor(name, readOnlyHint, properties = { id: uuid }, required = ['id']) {
  return {
    name,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false },
    'x-contract-fixture': { nativeDescriptorExtensionsArePreserved: true },
  };
}

const properties = {
  list_commercial_documents: { search: nullableText, page: version, per_page: version, sort: text, archived: { type: 'boolean' } },
  get_commercial_document: { id: uuid },
  upload_commercial_document: { title: text, producer_reference_id: uuid, claimed_mime: text },
  replace_commercial_document_version: { id: uuid, expected_version: version, producer_reference_id: uuid, claimed_mime: text },
  share_commercial_document: { id: uuid, expected_version: version, grant_type: text, grantee_id: uuid, expires_at: nullableText },
  revoke_commercial_document_share: { id: uuid, expected_version: version, share_id: uuid },
  archive_commercial_document: { id: uuid, expected_version: version },
  list_opportunity_documents: { id: uuid, filters: text, cursor: text, limit: version },
  list_opportunity_document_candidates: { id: uuid, document_type: text, search: text, cursor: nullableText, limit: version },
  get_opportunity_financial_summary: { id: uuid },
  create_opportunity_quote: { id: uuid, contact_id: { anyOf: [uuid, { type: 'null' }] }, quote_draft: { type: 'object' } },
  link_opportunity_document: { id: uuid, document_type: text, document_id: uuid, is_primary: { type: 'boolean' } },
  unlink_opportunity_document: { id: uuid, expected_version: version, link_id: uuid },
  move_service_ticket_to_stage: { id: uuid, expected_version: version, pipeline_id: uuid, stage_id: uuid, waiting_reason: nullableText, customer_message_id: { anyOf: [uuid, { type: 'null' }] } },
  attach_service_ticket_document: { id: uuid, expected_version: version, document_id: uuid, document_version: version },
  detach_service_ticket_document: { id: uuid, expected_version: version, attachment_id: uuid },
};

const required = {
  list_commercial_documents: [],
  share_commercial_document: ['id', 'expected_version', 'grant_type', 'grantee_id'],
  list_opportunity_documents: ['id'],
  list_opportunity_document_candidates: ['document_type', 'id'],
  create_opportunity_quote: ['id', 'quote_draft'],
  move_service_ticket_to_stage: ['id', 'expected_version', 'pipeline_id', 'stage_id'],
};

const contract = JSON.parse(readFileSync(new URL('../../../docs/crm/contract.json', import.meta.url), 'utf8'));
export const DOCUMENT_TOOLS = contract.operation_examples.map(({ name, read_only_example }) => {
  const fields = properties[name];
  if (!fields) throw new Error(`Missing test schema for documented operation: ${name}`);
  return descriptor(name, read_only_example,
    read_only_example ? fields : { ...fields, idempotency_key: nativeKey },
    required[name] ?? Object.keys(fields));
});

export const DOCUMENT_ARGUMENTS = {
  list_commercial_documents: { search: null, page: 2, per_page: 10, sort: 'id', archived: false },
  get_commercial_document: { id: UUID.document },
  upload_commercial_document: { title: 'Example document', producer_reference_id: UUID.producer, claimed_mime: 'application/pdf', idempotency_key: 'upload-original' },
  replace_commercial_document_version: { id: UUID.document, expected_version: 7, producer_reference_id: UUID.producer, claimed_mime: 'application/pdf', idempotency_key: 'replace-original' },
  share_commercial_document: { id: UUID.document, expected_version: 7, grant_type: 'team', grantee_id: UUID.stage, expires_at: null, idempotency_key: 'share-original' },
  revoke_commercial_document_share: { id: UUID.document, expected_version: 7, share_id: UUID.link, idempotency_key: 'revoke-original' },
  archive_commercial_document: { id: UUID.document, expected_version: 7, idempotency_key: 'archive-original' },
  list_opportunity_documents: { id: UUID.opportunity, filters: '{"is_primary":false}', cursor: 'owner/C7%2B==cursor', limit: 25 },
  list_opportunity_document_candidates: { id: UUID.opportunity, document_type: 'quote', search: '', cursor: null, limit: 25 },
  get_opportunity_financial_summary: { id: UUID.opportunity },
  create_opportunity_quote: { id: UUID.opportunity, contact_id: null, quote_draft: { date: '2026-10-09', recipient: { kind: 'unassigned', id: null }, notes: null, expected_root_version: 7, expected_line_version: 3 }, idempotency_key: 'quote-original' },
  link_opportunity_document: { id: UUID.opportunity, document_type: 'quote', document_id: UUID.document, is_primary: false, idempotency_key: 'link-original' },
  unlink_opportunity_document: { id: UUID.opportunity, expected_version: 3, link_id: UUID.link, idempotency_key: 'unlink-original' },
  move_service_ticket_to_stage: { id: UUID.ticket, expected_version: 7, pipeline_id: UUID.pipeline, stage_id: UUID.stage, waiting_reason: null, customer_message_id: UUID.activity, idempotency_key: 'move-original' },
  attach_service_ticket_document: { id: UUID.ticket, expected_version: 7, document_id: UUID.document, document_version: 17, idempotency_key: 'attach-original' },
  detach_service_ticket_document: { id: UUID.ticket, expected_version: 7, attachment_id: UUID.link, idempotency_key: 'detach-original' },
};

export const JOURNEY_TOOLS = [
  descriptor('create_lead', false, { name: nullableText, source: { type: 'string', enum: ['manual'] }, idempotency_key: nativeKey }, []),
  descriptor('find_lead', true),
  descriptor('create_opportunity', false, { title: text, lead_id: uuid, contact_id: { anyOf: [uuid, { type: 'null' }] }, pipeline_id: uuid, stage_id: uuid, amount: text, currency: text, idempotency_key: nativeKey }, ['title', 'pipeline_id', 'stage_id', 'amount', 'currency']),
  descriptor('get_opportunity', true),
  descriptor('list_opportunities', true, { filters: text, cursor: text, limit: version }, []),
  descriptor('create_crm_activity', false, { type: { type: 'string', enum: ['task', 'call', 'meeting', 'note'] }, title: text, body: nullableText, target: { type: 'object', additionalProperties: false, properties: { type: { type: 'string', enum: ['contact', 'person', 'lead', 'opportunity'] }, id: uuid }, required: ['type', 'id'] }, owner_id: { anyOf: [uuid, { type: 'null' }] }, due_at: nullableText, timezone: text, idempotency_key: nativeKey }, ['type', 'title', 'target', 'timezone', 'idempotency_key']),
  descriptor('get_crm_activity', true),
];

export function receipt(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ data }) }],
    structuredContent: { data },
    _meta: { 'fixture/original-owner-receipt': true },
    'x-future-native-result': { opaque: true },
  };
}
