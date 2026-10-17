// Offline contract checks are the default. Live probes contact the real MCP
// service only when explicitly enabled with an operator-owned sandbox fixture.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(await readFile(path.join(packageRoot, 'plugin-contract.json'), 'utf8'));
const live = process.env.FACTUAREA_CRM_LIVE === '1';
const toolsByName = new Map(contract.tools.map((tool) => [tool.name, tool]));
let prepared;

const EXPECTED_SCOPES = new Map([
  ['create_crm_activity', 'crm_activities:write'],
  ['create_lead', 'crm_leads:write'],
  ['create_opportunity', 'crm_opportunities:write'],
  ['find_lead', 'crm_leads:read'],
  ['get_crm_activity', 'crm_activities:read'],
  ['get_opportunity', 'crm_opportunities:read'],
  ['get_pipeline', 'crm_pipelines:read'],
  ['list_crm_activities', 'crm_activities:read'],
  ['list_pipelines', 'crm_pipelines:read'],
]);

const CALLER_AUTHORITY_FIELDS = new Set([
  'company_id',
  'tenant_id',
  'actor_id',
  'sandbox',
  'role',
  'credential_id',
  'connection_id',
  'effect_uuid',
]);

function object(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assertNativeFailure(response, marker) {
  assert.ok(response.error || response.result?.isError === true,
    'A denied or unavailable operation must fail explicitly, never return empty success');
  const error = response.error
    ? JSON.stringify(response.error)
    : response.result.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || '';
  assert.ok(error.includes(marker), 'The observed failure must match the recorded native failure type');
}

test('contract records source-only MCP compatibility and leaves live state unverified', () => {
  assert.equal(contract.contract_version, 1);
  assert.equal(contract.package, 'factuarea-crm-native');
  assert.equal(contract.surface, 'MCP');
  assert.equal(contract.server.url, 'https://mcp.factuarea.com');
  assert.equal(contract.server.transport, 'streamable-http');
  assert.equal(contract.server.production_enabled_by_package, false);
  assert.deepEqual(contract.server.compatibility.source_adapter_protocol_versions, ['2025-11-25', '2025-06-18']);
  assert.equal(contract.server.compatibility.modern_protocol_supported_by_backend, '2026-07-28');
  assert.equal(contract.server.compatibility.modern_protocol_supported_by_this_adapter, false);
  assert.equal(contract.server.compatibility.live_discovery_verified, false);
  assert.equal(contract.server.compatibility.server_version, null);
  assert.equal(contract.discovery.authority, 'current-authenticated-tools-list');
  assert.equal(contract.discovery.missing_tool, 'unavailable');
  assert.equal(contract.discovery.caller_selects_company, false);
  assert.equal(contract.delivery_state, 'source-only-live-installation-and-discovery-not-verified');
  assert.equal(JSON.stringify(contract).includes('WebMCP'), false);
});

test('contract contains only the nine source-pinned CRM commercial-journey tools and their native scopes', () => {
  assert.equal(contract.tools.length, EXPECTED_SCOPES.size);
  assert.equal(toolsByName.size, contract.tools.length, 'Tool names must be unique');
  assert.deepEqual([...toolsByName.keys()].sort(), [...EXPECTED_SCOPES.keys()].sort());

  for (const tool of contract.tools) {
    assert.equal(tool.area, 'commercial-journey');
    assert.equal(tool.scope, EXPECTED_SCOPES.get(tool.name));
    assert.equal(tool.category, tool.scope.endsWith(':read') ? 'READ' : 'WRITE');
    assert.match(tool.source_sha256, /^[a-f0-9]{64}$/);
    assert.match(tool.source, /^backend\/app\/.+\.php$/);
    assert.ok(Array.isArray(tool.required_arguments));
    assert.ok(Array.isArray(tool.optional_arguments));
    assert.equal(new Set([...tool.required_arguments, ...tool.optional_arguments]).size,
      tool.required_arguments.length + tool.optional_arguments.length,
      `${tool.name} repeats an argument`);
    for (const argument of [...tool.required_arguments, ...tool.optional_arguments]) {
      assert.ok(!CALLER_AUTHORITY_FIELDS.has(argument), `${tool.name} accepts caller authority ${argument}`);
    }
  }
});

test('live fixture uses separate sandbox credentials for Company A read/write and Company B read', { skip: !live }, async () => {
  const { fixture } = await setupLiveClients();
  assert.equal(fixture.operator_authorized, true);
  assert.equal(fixture.sandbox_context_verified, true);
});

test('live tools/list reflects distinct current read and write grants for Company A', { skip: !live }, async () => {
  const { fixture, readA, writeA } = await setupLiveClients();
  const reads = await readA.list();
  const writes = await writeA.list();
  assert.ok(reads.has(fixture.read_call.name), 'Company A read credential should discover its CRM read');
  assert.ok(!reads.has(fixture.write_tool), 'Company A read credential must not discover the write tool');
  assert.ok(writes.has(fixture.write_tool), 'Company A write credential should discover the authorized write');
});

test('live read call returns the Company A resource and a read credential cannot call a write tool', { skip: !live }, async () => {
  const { fixture, readA } = await setupLiveClients();
  assert.ok((await readA.list()).has(fixture.read_call.name), 'Fresh tools/list must expose the fixture read');
  const response = await readA.call(fixture.read_call);
  assert.ok(response.result && !response.error && response.result.isError !== true,
    'The Company A read must succeed');
  const texts = response.result.content?.filter((item) => item.type === 'text');
  assert.equal(texts?.length, 1, 'A successful CRM read must have one JSON text result');
  assert.equal(JSON.parse(texts[0].text)?.data?.id, fixture.read_call.expected_id,
    'The returned CRM resource must match the private sandbox fixture');
  assertNativeFailure(await readA.call(fixture.denied_write_call), fixture.denied_write_failure.native_error_marker);
});

test('live Company B cannot read the same private Company A CRM resource', { skip: !live }, async () => {
  const { fixture, readB } = await setupLiveClients();
  assert.ok((await readB.list()).has(fixture.read_call.name), 'Company B must have its own current CRM read grant');
  assertNativeFailure(await readB.call(fixture.read_call), fixture.cross_company_failure.native_error_marker);
});

test('live unavailable provider is absent or returns its recorded native failure', { skip: !live }, async () => {
  const { fixture, readA } = await setupLiveClients();
  const call = fixture.provider_unavailable.call;
  const visible = await readA.list();
  if (!visible.has(call.name)) return;
  assertNativeFailure(await readA.call(call), fixture.provider_unavailable.failure.native_error_marker);
});

async function setupLiveClients() {
  if (prepared) return prepared;

  const fixturePath = process.env.FACTUAREA_CRM_FIXTURE;
  assert.ok(fixturePath, 'A private fixture from actual sandbox resources is required');
  const permissions = (await stat(fixturePath)).mode & 0o777;
  assert.equal(permissions, 0o600, 'The fixture must be readable only by its owner');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const fixtureKeys = [
    'operator_authorized',
    'sandbox_context_verified',
    'company_a_read',
    'company_a_write',
    'company_b_read',
    'read_call',
    'write_tool',
    'denied_write_call',
    'denied_write_failure',
    'cross_company_failure',
    'provider_unavailable',
  ];
  assert.deepEqual(Object.keys(fixture).sort(), fixtureKeys.sort(), 'Fixture has an unexpected field set');
  assert.equal(fixture.operator_authorized, true, 'The operator must authorize this live sandbox probe');
  assert.equal(fixture.sandbox_context_verified, true, 'Verify the native sandbox before sending any call');

  const credentials = [fixture.company_a_read, fixture.company_a_write, fixture.company_b_read];
  const tokens = new Set();
  const clients = [];
  for (const credential of credentials) {
    object(credential, 'credential fixture');
    assert.deepEqual(Object.keys(credential).sort(), ['native_context_evidence', 'token_env']);
    assert.match(credential.token_env, /^FACTUAREA_CRM_[A-Z0-9_]+_TOKEN$/);
    assert.ok(typeof credential.native_context_evidence === 'string' && credential.native_context_evidence.length > 0,
      'Record native evidence for the selected company and scopes');
    const token = process.env[credential.token_env];
    assert.ok(typeof token === 'string' && token.length > 0, 'Supply credentials through private environment variables');
    assert.ok(token.startsWith('fact_test_'), 'Live probes require isolated test API keys');
    assert.ok(!tokens.has(token), 'Company A read/write and Company B require distinct credentials');
    tokens.add(token);
    clients.push(new NativeMcpHttpClient(token));
  }

  validateCall(fixture.read_call, { expectedId: true });
  assert.ok(['find_lead', 'get_crm_activity', 'get_opportunity', 'get_pipeline'].includes(fixture.read_call.name),
    'Use a single-resource CRM read for the private Company A fixture');
  assert.match(fixture.read_call.expected_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(toolsByName.get(fixture.write_tool)?.category, 'WRITE');
  assert.equal(fixture.denied_write_call.name, fixture.write_tool);
  validateCall(fixture.denied_write_call);
  validateCall(fixture.provider_unavailable.call);
  assert.equal(toolsByName.get(fixture.provider_unavailable.call.name)?.category, 'READ',
    'The unavailable-provider probe must be read-only');
  assert.ok(typeof fixture.provider_unavailable.native_provider_evidence === 'string'
    && fixture.provider_unavailable.native_provider_evidence.length > 0);

  for (const [label, value] of [
    ['denied-write failure', fixture.denied_write_failure],
    ['cross-company failure', fixture.cross_company_failure],
    ['provider-unavailable failure', fixture.provider_unavailable.failure],
  ]) {
    object(value, label);
    assert.deepEqual(Object.keys(value), ['native_error_marker']);
    assert.ok(typeof value.native_error_marker === 'string' && value.native_error_marker.length > 0,
      `Record the exact native ${label} marker`);
  }

  prepared = { fixture, readA: clients[0], writeA: clients[1], readB: clients[2] };
  return prepared;
}

function validateCall(call, { expectedId = false } = {}) {
  object(call, 'tool-call fixture');
  assert.deepEqual(Object.keys(call).sort(), [...['arguments', 'name'], ...(expectedId ? ['expected_id'] : [])].sort());
  const tool = toolsByName.get(call.name);
  assert.ok(tool, `Use a tool from the source contract: ${call.name}`);
  object(call.arguments, 'tool arguments');
  for (const field of CALLER_AUTHORITY_FIELDS) {
    assert.ok(!Object.hasOwn(call.arguments, field), `Never pass caller-supplied authority ${field}`);
  }
  for (const argument of tool.required_arguments) assert.ok(Object.hasOwn(call.arguments, argument), `Missing ${argument}`);
  for (const argument of Object.keys(call.arguments)) {
    assert.ok(tool.required_arguments.includes(argument) || tool.optional_arguments.includes(argument),
      `Unexpected argument ${argument} for ${call.name}`);
  }
}

class NativeMcpHttpClient {
  #token;
  #nextId = 0;
  #protocolVersion;
  #sessionId;

  constructor(token) {
    this.#token = token;
  }

  async connect() {
    let lastError;
    for (const protocolVersion of contract.server.compatibility.source_adapter_protocol_versions) {
      try {
        const response = await this.rpc('initialize', {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: contract.package, version: contract.package_version },
        }, { protocolVersion });
        assert.ok(response.result && !response.error, 'Native MCP initialize must succeed');
        assert.equal(response.result.protocolVersion, protocolVersion, 'Server must negotiate the requested legacy revision');
        assert.ok(response.result.capabilities?.tools, 'Native server must advertise tools capability');
        assert.ok(typeof response.result.serverInfo?.version === 'string' && response.result.serverInfo.version.length > 0,
          'Native initialize must report serverInfo.version');
        this.#protocolVersion = protocolVersion;
        await this.notification('notifications/initialized');
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async rpc(method, params = {}, { protocolVersion = this.#protocolVersion } = {}) {
    const id = ++this.#nextId;
    const response = await this.#send({ jsonrpc: '2.0', id, method, params }, protocolVersion);
    assert.ok(response.message && response.message.id === id && response.message.jsonrpc === '2.0',
      'Expected a matching native JSON-RPC response');
    return response.message;
  }

  async notification(method) {
    await this.#send({ jsonrpc: '2.0', method });
  }

  async #send(message, protocolVersion = this.#protocolVersion) {
    const headers = {
      Authorization: `Bearer ${this.#token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;
    if (this.#sessionId) headers['Mcp-Session-Id'] = this.#sessionId;
    const response = await fetch(contract.server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Native MCP HTTP request failed with status ${response.status}`);
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.#sessionId = sessionId;
    if (message.id === undefined && response.status === 202) return { message: null };
    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let result;
    if (contentType.includes('text/event-stream')) {
      const messages = body.split(/\r?\n\r?\n/).flatMap((event) => {
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) return [];
        try {
          return [JSON.parse(data)];
        } catch {
          return [];
        }
      });
      result = messages.find((item) => item.id === message.id);
    } else {
      result = JSON.parse(body);
    }
    return { message: result };
  }

  async list() {
    if (!this.#protocolVersion) await this.connect();
    const discovered = new Map();
    const seenCursors = new Set();
    let cursor;
    do {
      const response = await this.rpc('tools/list', cursor === undefined ? {} : { cursor });
      assert.ok(response.result && !response.error && Array.isArray(response.result.tools),
        'Native tools/list must return the current tool array');
      for (const descriptor of response.result.tools) {
        assert.ok(typeof descriptor.name === 'string' && descriptor.inputSchema?.type === 'object',
          'Every native tool descriptor must include inputSchema');
        discovered.set(descriptor.name, descriptor);
      }
      cursor = response.result.nextCursor;
      if (cursor !== undefined) {
        assert.ok(typeof cursor === 'string' && cursor.length > 0 && !seenCursors.has(cursor),
          'Native tools/list cursor must advance');
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);
    return discovered;
  }

  async call(call) {
    if (!this.#protocolVersion) await this.connect();
    return this.rpc('tools/call', { name: call.name, arguments: call.arguments });
  }
}
