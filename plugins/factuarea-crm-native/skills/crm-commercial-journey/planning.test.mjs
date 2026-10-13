// Offline synthetic planning fixtures only. These are not server identities or grants.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMERCIAL_TOOLS, PlanningError, activityOutcome, checkDiscovery, prepareNote, prepareOpportunity, recoveryPlan } from './planning.mjs';

const SYNTHETIC = Object.freeze({
  lead: '019ab100-0000-7000-8000-000000000001',
  pipeline: '019ab100-0000-7000-8000-000000000002',
  stage: '019ab100-0000-7000-8000-000000000003',
  opportunity: '019ab100-0000-7000-8000-000000000004',
  activity: '019ab100-0000-7000-8000-000000000005',
  effect: '019ab100-0000-7000-8000-000000000006',
});

function opportunityInput() {
  return {
    lead: { id: SYNTHETIC.lead, version: 3 },
    pipeline: { id: SYNTHETIC.pipeline, status: 'active', stages: [{ id: SYNTHETIC.stage, status: 'active', required_field_ids: [], definition_version: 2 }] },
    stageId: SYNTHETIC.stage, title: 'Synthetic offline intent', amount: '125.50',
    currency: 'EUR', originalKey: 'synthetic-offline-opportunity-intent',
    humanConfirmed: true, contextChanged: false,
  };
}

function noteInput() {
  return {
    opportunity: { id: SYNTHETIC.opportunity, version: 1, lead_id: SYNTHETIC.lead },
    confirmedOpportunityId: SYNTHETIC.opportunity, expectedLeadId: SYNTHETIC.lead,
    title: 'Synthetic offline note', timezone: 'Europe/Madrid',
    originalKey: 'synthetic-offline-note-intent', humanConfirmed: true, contextChanged: false,
  };
}

function fails(fn, code) {
  assert.throws(fn, (error) => error instanceof PlanningError && error.code === code);
}

test('native MCP names match; WebMCP aliases do not satisfy discovery', () => {
  assert.equal(checkDiscovery([...COMMERCIAL_TOOLS]).status, 'discovery-names-present');
  const aliases = COMMERCIAL_TOOLS.map((name) => name === 'create_lead' ? 'create_crm_lead' : name);
  assert.deepEqual(checkDiscovery(aliases).missing, ['create_lead']);
});

test('missing qualified tool is unavailable, no mirror or mutation fallback', () => {
  assert.equal(checkDiscovery(['find_lead']).status, 'unavailable');
  assert.equal(checkDiscovery(['find_lead']).execution, false);
});

test('opportunity preparation preserves the explicit Lead and current parent stage UUIDs', () => {
  const result = prepareOpportunity(opportunityInput());
  assert.equal(result.arguments.lead_id, SYNTHETIC.lead);
  assert.equal(result.arguments.pipeline_id, SYNTHETIC.pipeline);
  assert.equal(result.arguments.stage_id, SYNTHETIC.stage);
  assert.equal(result.arguments.amount, '125.50');
  assert.equal(result.execution, false);
  assert.equal(result.authority, 'native-server-required');
  assert.ok(!Object.hasOwn(result.arguments, 'contact_id'));
  assert.ok(!Object.hasOwn(result.arguments, 'id'));
});

test('email cannot stand in for a Lead identity', () => {
  const input = opportunityInput(); input.lead.id = 'someone@example.invalid';
  fails(() => prepareOpportunity(input), 'native_uuid_required');
});

test('a stage outside the observed pipeline is rejected', () => {
  const input = opportunityInput(); input.stageId = SYNTHETIC.opportunity;
  fails(() => prepareOpportunity(input), 'stage_not_in_current_active_pipeline');
});

test('hidden stage catalog or requirements do not become empty/default', () => {
  const hidden = opportunityInput(); delete hidden.pipeline.stages;
  fails(() => prepareOpportunity(hidden), 'stage_catalog_unavailable');
  const requirements = opportunityInput(); delete requirements.pipeline.stages[0].required_field_ids;
  fails(() => prepareOpportunity(requirements), 'stage_requirements_unavailable');
  const explicit = opportunityInput(); explicit.pipeline.stages[0].required_field_ids = [SYNTHETIC.lead];
  fails(() => prepareOpportunity(explicit), 'native_requirement_review_required');
});

test('Money stays decimal text and caller cannot inject Company/role', () => {
  const amount = opportunityInput(); amount.amount = 125.5;
  fails(() => prepareOpportunity(amount), 'decimal_amount_required');
  const authority = opportunityInput(); authority.company_id = 42;
  fails(() => prepareOpportunity(authority), 'unsupported_fields');
});

test('human review and context changes stop automatic progression', () => {
  const review = opportunityInput(); review.humanConfirmed = false;
  assert.equal(prepareOpportunity(review).status, 'needs-human-confirmation');
  const changed = opportunityInput(); changed.contextChanged = true;
  fails(() => prepareOpportunity(changed), 'context_changed_or_unknown');
});

test('note binds only the confirmed opportunity, preserving omitted/null body', () => {
  const absent = prepareNote(noteInput());
  assert.deepEqual(absent.arguments.target, { type: 'opportunity', id: SYNTHETIC.opportunity });
  assert.equal(absent.arguments.type, 'note');
  assert.ok(!Object.hasOwn(absent.arguments, 'body'));
  const input = noteInput(); input.body = null;
  assert.equal(prepareNote(input).arguments.body, null);
  assert.ok(!Object.hasOwn(absent.arguments, 'confirmed'));
  assert.ok(!Object.hasOwn(absent.arguments, 'original_wire'));
});

test('hidden or mismatched opportunity link cannot be rebuilt from original request', () => {
  const input = noteInput(); delete input.opportunity.lead_id;
  fails(() => prepareNote(input), 'lead_link_unavailable_or_mismatched');
  const mismatch = noteInput(); mismatch.opportunity.id = SYNTHETIC.activity;
  fails(() => prepareNote(mismatch), 'original_opportunity_identity_mismatch');
});

test('Activity result consumes state/activity_id, not a fabricated data.id success', () => {
  const result = activityOutcome({ data: { state: 'unconfirmed', activity_id: SYNTHETIC.activity, effect_id: SYNTHETIC.effect, activity: null } });
  assert.equal(result.status, 'uncertain-stop');
  assert.equal(result.knownServerId, SYNTHETIC.activity);
  const confirmed = activityOutcome({ data: { state: 'confirmed', activity_id: SYNTHETIC.activity, effect_id: SYNTHETIC.effect, activity: null } });
  assert.equal(confirmed.status, 'confirmed-native-result');
});

test('409 proposes a separate current read and human review, never key replacement or resend', () => {
  const result = recoveryPlan('create_opportunity', 'conflict', SYNTHETIC.opportunity);
  assert.equal(result.status, 'reread-and-human-review');
  assert.deepEqual(result.actions[0], { kind: 'current-read-only', tool: 'get_opportunity', arguments: { id: SYNTHETIC.opportunity } });
  assert.equal(result.resend, false);
  assert.equal(result.generateNewKey, false);
  assert.equal(result.advanceJourney, false);
});

test('unconfirmed with or without UUID never fabricates an Original query or receipt', () => {
  for (const operation of ['create_lead', 'create_opportunity', 'create_crm_activity']) {
    const known = recoveryPlan(operation, 'unconfirmed', SYNTHETIC.activity);
    assert.equal(known.actions.length, 1);
    assert.equal(known.originalQuery, null);
    assert.equal(known.currentReadIsReceipt, false);
    assert.equal(known.preserveOriginalKeyAndArguments, true);
    assert.equal(known.advanceJourney, false);
    assert.equal(recoveryPlan(operation, 'timeout').actions.length, 0);
  }
});

test('revocation and provider outage produce no private read or fallback action', () => {
  for (const status of ['revoked', 'unavailable']) {
    const result = recoveryPlan('create_lead', status, SYNTHETIC.lead);
    assert.deepEqual(result.actions, []);
    assert.equal(result.resend, false);
  }
});
