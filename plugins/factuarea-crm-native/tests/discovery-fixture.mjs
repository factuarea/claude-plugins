// Pure preflight for the operator-owned live harness. No files, env, network or credentials.
import assert from 'node:assert/strict';

function closed(object, required, allowed = required) {
  assert.ok(object !== null && typeof object === 'object' && !Array.isArray(object), 'Fixture requires a JSON object');
  assert.equal(Object.getPrototypeOf(object), Object.prototype, 'Fixture requires a JSON object');
  for (const key of required) assert.ok(Object.hasOwn(object, key), `Missing fixture property ${key}`);
  for (const key of Object.keys(object)) assert.ok(allowed.includes(key), `Unknown fixture property ${key}`);
}

function nonempty(value, message) {
  assert.ok(typeof value === 'string' && value.trim().length > 0, message);
}

/** Validate the entire fixture before resolving tokens or initializing any MCP client. */
export function validateDiscoveryFixture(fixture, contract) {
  closed(fixture, ['operator_authorized', 'sandbox_context_verified', 'protocol_version', 'company_a_read', 'company_a_write', 'company_b_read', 'read_call', 'write_tool', 'denied_write_call', 'denied_write_failure', 'cross_company_failure', 'provider_unavailable']);
  assert.equal(fixture.operator_authorized, true, 'Operator must authorize the actual sandbox test');
  assert.equal(fixture.sandbox_context_verified, true, 'Operator must verify native sandbox selection, not add sandbox arguments');
  assert.ok(typeof fixture.protocol_version === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fixture.protocol_version), 'Explicit protocol version required');
  const compatibility = contract.server.protocol_compatibility;
  assert.ok([...compatibility.modern, ...compatibility.legacy_initialize].includes(fixture.protocol_version), 'Protocol must belong to the declared Source compatibility set; live negotiation remains separate');

  const credentials = [fixture.company_a_read, fixture.company_a_write, fixture.company_b_read];
  const envNames = new Set();
  for (const credential of credentials) {
    closed(credential, ['token_env', 'native_context_evidence']);
    assert.ok(typeof credential.token_env === 'string' && /^FACTUAREA_CRM_[A-Z0-9_]+_TOKEN$/.test(credential.token_env), 'Private token environment name required');
    nonempty(credential.native_context_evidence, 'Actual consent/credential context evidence is required');
    assert.ok(!envNames.has(credential.token_env), 'Read/write and Companies A/B need distinct credential environment names');
    envNames.add(credential.token_env);
  }

  closed(fixture.read_call, ['name', 'arguments', 'expected_id']);
  closed(fixture.denied_write_call, ['name', 'arguments']);
  closed(fixture.provider_unavailable, ['call', 'failure', 'native_provider_evidence']);
  closed(fixture.provider_unavailable.call, ['name', 'arguments']);
  nonempty(fixture.provider_unavailable.native_provider_evidence, 'Actual unavailable-provider evidence is required');

  const tools = new Map(contract.tools.map((tool) => [tool.name, tool]));
  for (const call of [fixture.read_call, fixture.denied_write_call, fixture.provider_unavailable.call]) {
    assert.ok(typeof call.name === 'string' && tools.has(call.name), 'Fixture tool must be an actual native tool in this package');
    const tool = tools.get(call.name);
    closed(call.arguments, tool.required_arguments, [...tool.required_arguments, ...tool.optional_arguments]);
    for (const name of ['company_id', 'sandbox', 'actor_id', 'role', 'effect_uuid']) assert.ok(!Object.hasOwn(call.arguments, name), 'No caller-created authority');
  }

  assert.ok(['get_booking_service', 'get_task_time_entry'].includes(fixture.read_call.name), 'Scoped singular current-read tool required');
  const read = tools.get(fixture.read_call.name);
  assert.equal(read.category, 'READ');
  assert.ok(read.scope.endsWith(':read'), 'Current-read probe needs a native read scope');
  assert.ok(typeof fixture.read_call.expected_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fixture.read_call.expected_id), 'Actual public UUID v7 required');
  const identityArgument = fixture.read_call.name === 'get_booking_service' ? 'id' : 'time_entry_id';
  assert.equal(fixture.read_call.arguments[identityArgument], fixture.read_call.expected_id, 'Expected identity must match the singular resource requested');

  const denied = tools.get(fixture.denied_write_call.name);
  assert.equal(denied.category, 'WRITE', 'Denied-write case cannot target an original Query or destructive effect');
  assert.equal(fixture.denied_write_call.name, fixture.write_tool, 'Discovery and denied-call probes must use the same writer');
  assert.ok(denied.scope.endsWith(':write'), 'Denied-call probe needs a native writer scope');
  assert.equal(tools.get(fixture.provider_unavailable.call.name).category, 'READ', 'Unavailable-provider probe must be query-only');
  for (const failure of [fixture.denied_write_failure, fixture.cross_company_failure, fixture.provider_unavailable.failure]) {
    closed(failure, ['native_error_marker']);
    nonempty(failure.native_error_marker, 'Exact typed native error marker is required; no validation-error substitute');
  }
  return credentials;
}
