// Offline harness checks only. These sentinels are not an operator/live fixture,
// native resources, grants, sandbox authorization or evidence of server behavior.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateDiscoveryFixture } from './discovery-fixture.mjs';

const contract = JSON.parse(await readFile(new URL('../plugin-contract.json', import.meta.url), 'utf8'));
const id = '00000000-0000-7000-8000-000000000001';
const otherId = '00000000-0000-7000-8000-000000000002';
function shape() {
  const credential = (role) => ({ token_env: `FACTUAREA_CRM_UNIT_${role}_TOKEN`, native_context_evidence: 'Offline shape sentinel; never actual consent' });
  const failure = () => ({ native_error_marker: 'offline_shape_sentinel' });
  return {
    operator_authorized: true,
    sandbox_context_verified: true,
    protocol_version: '2026-07-28',
    company_a_read: credential('A_READ'),
    company_a_write: credential('A_WRITE'),
    company_b_read: credential('B_READ'),
    read_call: { name: 'get_booking_service', arguments: { id }, expected_id: id },
    write_tool: 'create_lead',
    denied_write_call: { name: 'create_lead', arguments: { name: 'Offline shape sentinel' } },
    denied_write_failure: failure(),
    cross_company_failure: failure(),
    provider_unavailable: {
      call: { name: 'list_booking_services', arguments: {} },
      failure: failure(),
      native_provider_evidence: 'Offline shape sentinel; never an actual provider state',
    },
  };
}

test('preflight accepts a closed shape and leaves the supplied intent unchanged', () => {
  const fixture = shape();
  const before = structuredClone(fixture);
  const credentials = validateDiscoveryFixture(fixture, contract);
  assert.deepEqual(credentials, [fixture.company_a_read, fixture.company_a_write, fixture.company_b_read]);
  assert.deepEqual(fixture, before);
});

const invalid = [
  ['missing operator authorization', (fixture) => { fixture.operator_authorized = false; }],
  ['unverified sandbox', (fixture) => { fixture.sandbox_context_verified = false; }],
  ['undeclared protocol', (fixture) => { fixture.protocol_version = '2099-01-01'; }],
  ['shared credential environment', (fixture) => { fixture.company_b_read.token_env = fixture.company_a_read.token_env; }],
  ['credential with a supplied token', (fixture) => { fixture.company_a_read.token = 'unit-sentinel'; }],
  ['blank context evidence', (fixture) => { fixture.company_a_write.native_context_evidence = ' '; }],
  ['caller-selected Company', (fixture) => { fixture.read_call.arguments.company_id = 1; }],
  ['undeclared argument', (fixture) => { fixture.denied_write_call.arguments.unknown_field = 'unit'; }],
  ['missing native required argument', (fixture) => { delete fixture.read_call.arguments.id; }],
  ['expected identity differs from requested resource', (fixture) => { fixture.read_call.expected_id = otherId; }],
  ['original writer Query used as current read', (fixture) => { fixture.read_call = { name: 'get_crm_sequence_original', arguments: { idempotency_key: 'offline-sentinel' }, expected_id: id }; }],
  ['original Query used as denied writer', (fixture) => { fixture.write_tool = 'get_crm_sequence_original'; fixture.denied_write_call = { name: fixture.write_tool, arguments: { idempotency_key: 'offline-sentinel' } }; }],
  ['different discovery and denied writers', (fixture) => { fixture.write_tool = 'create_opportunity'; }],
  ['provider probe attempts a mutation', (fixture) => { fixture.provider_unavailable.call = { name: 'create_lead', arguments: {} }; }],
  ['blank typed failure marker', (fixture) => { fixture.provider_unavailable.failure.native_error_marker = ' '; }],
  ['provider fixture is null', (fixture) => { fixture.provider_unavailable = null; }],
];
for (const [name, mutate] of invalid) {
  test(`preflight rejects ${name} before any client initialization`, () => {
    const fixture = shape();
    mutate(fixture);
    assert.throws(() => validateDiscoveryFixture(fixture, contract), assert.AssertionError);
  });
}

test('Task current-read preflight binds the time entry identity and keeps its Task argument', () => {
  const fixture = shape();
  fixture.read_call = { name: 'get_task_time_entry', arguments: { task_id: otherId, time_entry_id: id }, expected_id: id };
  assert.doesNotThrow(() => validateDiscoveryFixture(fixture, contract));
  delete fixture.read_call.arguments.task_id;
  assert.throws(() => validateDiscoveryFixture(fixture, contract), assert.AssertionError);
});
