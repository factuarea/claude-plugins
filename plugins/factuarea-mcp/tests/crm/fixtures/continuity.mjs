import { DOCUMENT_TOOLS, DOCUMENT_ARGUMENTS, JOURNEY_TOOLS, UUID, descriptor, receipt } from './catalogues.mjs';

export { DOCUMENT_TOOLS, DOCUMENT_ARGUMENTS, JOURNEY_TOOLS, UUID, receipt };

// Synthetic callback fixtures for the published native fields. These are not
// a hosted tools/list capture, OAuth grant or proof that CRM is enabled.
const uuid = { type: 'string', format: 'uuid' };
const properties = {
  id: uuid,
  strategy: { type: 'string', enum: ['link_existing', 'create_contact'] },
  business_contact_id: uuid,
  person_id: uuid,
  role_action: { type: 'string', enum: ['preserve', 'assign'] },
  role: { type: 'string', enum: ['customer', 'supplier', 'lead'] },
  activate_existing: { type: 'boolean' },
  contact: { type: 'object' },
};

export const CONVERSION_TOOLS = [
  descriptor('preview_lead_conversion', true, properties, ['id', 'strategy']),
  descriptor('convert_lead', false, { ...properties,
    expected_version: { type: 'integer', minimum: 1, maximum: 4294967295 },
    plan_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    confirmed: { type: 'boolean', const: true },
    idempotency_key: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[ -~]+$' },
  }, ['id', 'strategy', 'expected_version', 'plan_hash', 'confirmed']),
];

export const PRESERVE_INTENT = Object.freeze({ id: UUID.lead, strategy: 'link_existing',
  business_contact_id: UUID.document, role_action: 'preserve' });

export function conversionPlan(intent = PRESERVE_INTENT, override = {}) {
  return { lead_id: intent.id, lead_version: 7, strategy: intent.strategy,
    contact_id: intent.strategy === 'link_existing' ? intent.business_contact_id : null,
    normalized_draft: intent.strategy === 'link_existing' ? {} : structuredClone(intent.contact),
    roles_before: ['customer', 'supplier'], roles_after: ['customer', 'supplier'],
    conflicts: [], plan_hash: 'a'.repeat(64), ...override };
}

export function nativeDocument(override = {}) {
  return { id: UUID.document, version: 17, title: 'Current native document',
    shares: [{ id: UUID.link, grant_type: 'team', grantee_id: UUID.stage,
      expires_at: null, revoked_at: null }], ...override };
}
