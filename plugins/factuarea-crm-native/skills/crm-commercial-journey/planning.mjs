// Pure operator planning only: no credentials, auth, network, UUID allocation or execution.
// Runtime identity, discovery and authorization must still come from the native server.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const COMMERCIAL_TOOLS = Object.freeze([
  'create_lead', 'find_lead', 'list_pipelines', 'get_pipeline',
  'create_opportunity', 'get_opportunity', 'create_crm_activity',
  'get_crm_activity', 'list_crm_activities',
]);
const READ_FOR_CREATE = Object.freeze({
  create_lead: 'find_lead', create_opportunity: 'get_opportunity',
  create_crm_activity: 'get_crm_activity',
});

export class PlanningError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function require(value, code) {
  if (!value) throw new PlanningError(code);
}

function id(value) {
  require(typeof value === 'string' && UUID.test(value), 'native_uuid_required');
  return value;
}

function closed(object, allowed) {
  require(object !== null && typeof object === 'object' && Object.getPrototypeOf(object) === Object.prototype, 'native_object_required');
  require(Object.keys(object).every((key) => allowed.includes(key)), 'unsupported_fields');
}

function text(value, maximum, field) {
  require(typeof value === 'string' && value.length > 0 && value.length <= maximum, field);
  return value;
}

function key(value) {
  require(typeof value === 'string' && /^[\x20-\x7e]{1,255}$/.test(value), 'original_key_required');
  return value;
}

function nativePlan(tool, args, humanConfirmed, contextChanged) {
  require(typeof humanConfirmed === 'boolean', 'human_review_required');
  require(contextChanged === false, 'context_changed_or_unknown');
  return Object.freeze({
    kind: 'plan', execution: false, authority: 'native-server-required',
    status: humanConfirmed ? 'prepared-for-native-call' : 'needs-human-confirmation',
    tool, arguments: Object.freeze(args),
  });
}

export function checkDiscovery(names) {
  require(Array.isArray(names) && names.every((name) => typeof name === 'string'), 'actual_discovery_names_required');
  const discovered = new Set(names);
  const missing = COMMERCIAL_TOOLS.filter((name) => !discovered.has(name));
  return Object.freeze({
    kind: 'plan', execution: false, authority: 'native-server-required',
    status: missing.length ? 'unavailable' : 'discovery-names-present',
    missing: Object.freeze(missing),
  });
}

export function prepareOpportunity(input) {
  closed(input, ['lead', 'pipeline', 'stageId', 'title', 'amount', 'currency', 'originalKey', 'humanConfirmed', 'contextChanged']);
  const leadId = id(input.lead?.id);
  require(Number.isInteger(input.lead.version) && input.lead.version > 0, 'current_lead_version_required');
  const pipelineId = id(input.pipeline?.id);
  require(input.pipeline.status === 'active', 'current_active_pipeline_required');
  require(Array.isArray(input.pipeline.stages), 'stage_catalog_unavailable');
  const stageId = id(input.stageId);
  const stage = input.pipeline.stages.find((item) => item.id === stageId);
  require(stage?.status === 'active', 'stage_not_in_current_active_pipeline');
  require(Array.isArray(stage.required_field_ids), 'stage_requirements_unavailable');
  require(stage.required_field_ids.length === 0, 'native_requirement_review_required');
  require(Number.isInteger(stage.definition_version) && stage.definition_version >= 0, 'current_stage_definition_required');
  const amount = text(input.amount, 21, 'decimal_amount_required');
  require(/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/.test(amount), 'decimal_amount_required');
  require(typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency), 'iso_currency_required');
  return nativePlan('create_opportunity', {
    title: text(input.title, 255, 'title_required'), lead_id: leadId,
    pipeline_id: pipelineId, stage_id: stageId, amount, currency: input.currency,
    idempotency_key: key(input.originalKey),
  }, input.humanConfirmed, input.contextChanged);
}

export function prepareNote(input) {
  closed(input, ['opportunity', 'confirmedOpportunityId', 'expectedLeadId', 'title', 'body', 'timezone', 'originalKey', 'humanConfirmed', 'contextChanged']);
  const opportunityId = id(input.opportunity?.id);
  require(opportunityId === id(input.confirmedOpportunityId), 'original_opportunity_identity_mismatch');
  require(Object.hasOwn(input.opportunity, 'lead_id') && input.opportunity.lead_id === id(input.expectedLeadId), 'lead_link_unavailable_or_mismatched');
  require(Number.isInteger(input.opportunity.version) && input.opportunity.version > 0, 'current_opportunity_version_required');
  const timezone = text(input.timezone, 100, 'explicit_iana_timezone_required');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new PlanningError('explicit_iana_timezone_required');
  }
  const args = {
    type: 'note', title: text(input.title, 255, 'title_required'),
    target: Object.freeze({ type: 'opportunity', id: opportunityId }),
    timezone, idempotency_key: key(input.originalKey),
  };
  if (Object.hasOwn(input, 'body')) {
    require(input.body === null || (typeof input.body === 'string' && input.body.length <= 65535), 'body_shape');
    args.body = input.body;
  }
  return nativePlan('create_crm_activity', args, input.humanConfirmed, input.contextChanged);
}

export function activityOutcome(payload) {
  const data = payload?.data;
  require(data && ['pending', 'in_progress', 'unconfirmed', 'confirmed'].includes(data.state), 'native_activity_state_required');
  const activityId = id(data.activity_id);
  id(data.effect_id);
  require(data.activity_id !== data.effect_id, 'native_activity_effect_identities_must_differ');
  if (data.state !== 'confirmed') {
    require(data.activity === null, 'unconfirmed_has_no_success_representation');
  }
  return Object.freeze({
    kind: 'plan', execution: false, authority: 'native-server-required',
    status: data.state === 'confirmed' ? 'confirmed-native-result' : 'uncertain-stop',
    knownServerId: activityId, originalReceiptReconstructed: false,
  });
}

export function recoveryPlan(operation, status, knownServerId = null) {
  require(Object.hasOwn(READ_FOR_CREATE, operation), 'unknown_native_create');
  require(['conflict', 'unconfirmed', 'pending', 'in_progress', 'timeout', 'unavailable', 'revoked'].includes(status), 'native_failure_status_required');
  if (knownServerId !== null) id(knownServerId);
  const readable = knownServerId !== null && !['unavailable', 'revoked'].includes(status);
  return Object.freeze({
    kind: 'plan', execution: false, authority: 'native-server-required',
    status: status === 'conflict' ? 'reread-and-human-review' : 'uncertain-stop',
    preserveOriginalKeyAndArguments: true, resend: false, generateNewKey: false,
    originalQuery: null, currentReadIsReceipt: false, advanceJourney: false,
    actions: Object.freeze(readable ? [Object.freeze({
      kind: 'current-read-only', tool: READ_FOR_CREATE[operation],
      arguments: Object.freeze({ id: knownServerId }),
    })] : []),
  });
}
