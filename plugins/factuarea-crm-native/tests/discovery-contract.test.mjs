// Static contract checks run offline. Live MCP calls are opt-in and require
// operator-owned sandbox credentials plus a private fixture with mode 0600.
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

const EXPECTED_TOOLS = new Map([
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

const FORBIDDEN_ARGUMENTS = new Set([
  'company_id',
  'tenant_id',
  'actor_id',
  'sandbox',
  'role',
  'credential_id',
  'connection_id',
  'effect_uuid',
]);

function hasOnlyKeys(value, allowed, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label} has unsupported field ${key}`);
}

test('plugin contract describes the current native CRM MCP surface and leaves live status explicit', () => {
  hasOnlyKeys(contract, ['contract_version', 'package', 'package_version', 'surface', 'server', 'discovery', 'delivery_state', 'tools'], 'contract');
  assert.equal(contract.contract_version, 1);
  assert.equal(contract.package, 'factuarea-crm-native');
  assert.match(contract.package_version, /^\d+\.\d+\.\d+$/);
  assert.equal(contract.surface, 'MCP');
  assert.equal(contract.server.url, 'https://mcp.factuarea.com');
  assert.equal(contract.server.transport, 'streamable-http');
  assert.deepEqual(contract.server.authentication, ['host-managed-oauth', 'bearer-api-key']);
  assert.equal(contract.server.company_context, 'native-consent-or-current-credential');
  assert.deepEqual(contract.server.protocol, {
    current: '2026-07-28',
    legacy: ['2025-11-25', '2025-06-18'],
    live_compatibility_verified: false,
    server_version: null,
  });
  assert.equal(contract.delivery_state, 'source-only-live-installation-and-discovery-not-verified');
  assert.equal(contract.server.protocol.live_compatibility_verified, false);
  assert.equal(contract.server.protocol.server_version, null);
});

test('contract names and scopes are native CRM MCP tools, not WebMCP aliases', () => {
  assert.equal(contract.tools.length, EXPECTED_TOOLS.size);
  assert.deepEqual([...toolsByName.keys()].sort(), [...EXPECTED_TOOLS.keys()].sort());
  assert.equal(toolsByName.size, contract.tools.length, 'Tool names must be unique');

  for (const tool of contract.tools) {
    hasOnlyKeys(tool, [
      'name',
      'area',
      'scope',
      'category',
      'operation',
      'required_arguments',
      'optional_arguments',
    ], `tool ${tool.name}`);
    assert.equal(tool.scope, EXPECTED_TOOLS.get(tool.name));
    assert.equal(tool.area, 'commercial-journey');
    assert.match(tool.name, /^[a-z][a-z0-9_]+$/);
    assert.match(tool.operation, /^crm_(leads|opportunities|activities|pipelines)\.(create|show|index)$/);
    assert.equal(tool.category, tool.scope.endsWith(':read') ? 'READ' : 'WRITE');
    assert.ok(Array.isArray(tool.required_arguments));
    assert.ok(Array.isArray(tool.optional_arguments));
    assert.equal(new Set([...tool.required_arguments, ...tool.optional_arguments]).size,
      tool.required_arguments.length + tool.optional_arguments.length,
      `${tool.name} repeats an argument`);

    for (const argument of [...tool.required_arguments, ...tool.optional_arguments]) {
      assert.ok(!FORBIDDEN_ARGUMENTS.has(argument), `${tool.name} must not accept caller-supplied authority ${argument}`);
    }
  }
});

test('plugin contract treats the authenticated server catalog as authority and leaves absent tools unavailable', () => {
  assert.deepEqual(contract.discovery, {
    authority: 'current-authenticated-tools-list',
    missing_tool: 'unavailable',
    input_schema: 'use-native-schema-unchanged',
    scope_policy: 'server-must-check-current-grants-on-discovery-and-call',
    tenant_context: 'derived-from-current-credential',
    caller_selects_company: false,
  });
  assert.equal(JSON.stringify(contract).includes('WebMCP'), false);
  assert.equal(JSON.stringify(contract).includes('company_id'), false);
});

async function setupLiveClients() {
  if (prepared) return prepared;

  const fixturePath = process.env.FACTUAREA_CRM_FIXTURE;
  assert.ok(fixturePath, 'A private fixture from actual sandbox resources is required');
  const permissions = (await stat(fixturePath)).mode & 0o777;
  assert.equal(permissions, 0o600, 'The fixture must be readable only by its owner');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  hasOnlyKeys(fixture, [
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
  ], 'fixture');
  assert.equal(fixture.operator_authorized, true, 'The operator must authorize this live sandbox check');
  assert.equal(fixture.sandbox_context_verified, true, 'Verify the server-side sandbox before sending any call');

  const credentialCases = [fixture.company_a_read, fixture.company_a_write, fixture.company_b_read];
  const tokens = new Set();
  const clients = [];
  for (const credential of credentialCases) {
    hasOnlyKeys(credential, ['token_env', 'native_context_evidence'], 'credential fixture');
    assert.match(credential.token_env, /^FACTUAREA_CRM_[A-Z0-9_]+_TOKEN$/);
    assert.ok(typeof credential.native_context_evidence === 'string' && credential.native_context_evidence.length > 0,
      'Record how the server selected the company and scopes');
    const token = process.env[credential.token_env];
    assert.ok(typeof token === 'string' && token.length > 0, 'Supply credentials only through their private environment variables');
    assert.ok(token.startsWith('fact_test_'), 'Live calls require isolated fact_test_ API keys');
    assert.ok(!tokens.has(token), 'Read/write and Company A/B require distinct credentials');
    tokens.add(token);
    clients.push(new NativeMcpClient(token));
  }

  hasOnlyKeys(fixture.read_call, ['name', 'arguments', 'expected_id'], 'read call');
  assert.ok(['find_lead', 'get_crm_activity', 'get_opportunity', 'get_pipeline'].includes(fixture.read_call.name),
    'Use a singular CRM read for the private Company A resource check');
  assert.match(fixture.read_call.expected_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  for (const call of [fixture.read_call, fixture.denied_write_call, fixture.provider_unavailable.call]) {
    hasOnlyKeys(call, ['name', 'arguments', ...(call === fixture.read_call ? ['expected_id'] : [])], 'tool call fixture');
    const tool = toolsByName.get(call.name);
    assert.ok(tool, 'Use an exact tool name from the plugin contract');
    assert.ok(call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments));
    for (const argument of FORBIDDEN_ARGUMENTS) {
      assert.ok(!Object.hasOwn(call.arguments, argument), 'Never pass caller-created tenant, actor, sandbox or effect authority');
    }
    for (const name of tool.required_arguments) assert.ok(Object.hasOwn(call.arguments, name), `Missing required ${name}`);
    for (const name of Object.keys(call.arguments)) {
      assert.ok(tool.required_arguments.includes(name) || tool.optional_arguments.includes(name), `Unexpected argument ${name}`);
    }
  }

  assert.equal(fixture.write_tool, fixture.denied_write_call.name);
  assert.equal(toolsByName.get(fixture.write_tool)?.category, 'WRITE');
  hasOnlyKeys(fixture.denied_write_failure, ['native_error_marker'], 'denied-write failure');
  hasOnlyKeys(fixture.cross_company_failure, ['native_error_marker'], 'cross-company failure');
  hasOnlyKeys(fixture.provider_unavailable, ['call', 'failure', 'native_provider_evidence'], 'provider-unavailable fixture');
  assert.equal(toolsByName.get(fixture.provider_unavailable.call.name)?.category, 'READ',
    'The unavailable-provider probe must be read-only');
  assert.ok(typeof fixture.provider_unavailable.native_provider_evidence === 'string'
    && fixture.provider_unavailable.native_provider_evidence.length > 0);
  for (const failure of [fixture.denied_write_failure, fixture.cross_company_failure, fixture.provider_unavailable.failure]) {
    hasOnlyKeys(failure, ['native_error_marker'], 'native failure marker');
    assert.ok(typeof failure.native_error_marker === 'string' && failure.native_error_marker.length > 0,
      'Record an exact native denial/unavailable marker');
  }

  prepared = { fixture, readA: clients[0], writeA: clients[1], readB: clients[2] };
  return prepared;
}

class NativeMcpClient {
  #token;
  #nextId = 0;

  constructor(token) {
    this.#token = token;
  }

  async rpc(method, params = {}) {
    const id = ++this.#nextId;
    const name = method === 'tools/call' ? params.name : undefined;
    const metadata = {
      'io.modelcontextprotocol/protocolVersion': contract.server.protocol.current,
      'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: contract.package, version: contract.package_version },
    };
    const headers = {
      Authorization: `Bearer ${this.#token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': contract.server.protocol.current,
      'Mcp-Method': method,
    };
    if (typeof name === 'string') headers['Mcp-Name'] = name;

    const response = await fetch(contract.server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: metadata } }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `The MCP request failed with HTTP ${response.status}`);
    assert.equal(response.headers.has('mcp-session-id'), false, 'The current HTTP MCP transport is sessionless');

    const body = await response.text();
    let message;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
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
      message = messages.find((item) => item.id === id);
    } else {
      message = JSON.parse(body);
    }
    assert.ok(message && message.id === id && message.jsonrpc === '2.0', 'A matching JSON-RPC response is required');
    return message;
  }

  async list() {
    const discovery = await this.rpc('server/discover');
    assert.ok(discovery.result && !discovery.error, 'The native server discovery request must succeed');
    assert.ok(discovery.result.supportedVersions?.includes(contract.server.protocol.current),
      'The native server must advertise the contracted protocol revision');

    const discovered = new Map();
    const cursors = new Set();
    let cursor;
    do {
      const response = await this.rpc('tools/list', cursor ? { cursor } : {});
      assert.ok(response.result && !response.error && Array.isArray(response.result.tools),
        'Authenticated tools/list must return the current tool array');
      for (const descriptor of response.result.tools) {
        assert.ok(typeof descriptor.name === 'string' && descriptor.inputSchema?.type === 'object',
          'Every advertised tool must include its native inputSchema');
        assert.ok(!discovered.has(descriptor.name), 'The authenticated catalog must not duplicate a tool');
        discovered.set(descriptor.name, descriptor);
      }
      cursor = response.result.nextCursor;
      if (cursor !== undefined) {
        assert.ok(typeof cursor === 'string' && cursor.length > 0 && !cursors.has(cursor),
          'Only advancing opaque native cursors are accepted');
        cursors.add(cursor);
      }
    } while (cursor !== undefined);

    for (const [name, descriptor] of discovered) {
      const expected = toolsByName.get(name);
      if (!expected) continue;
      const properties = descriptor.inputSchema.properties || {};
      assert.deepEqual([...new Set(descriptor.inputSchema.required || [])].sort(),
        [...expected.required_arguments].sort(), `${name} required fields differ from the source contract`);
      assert.deepEqual(Object.keys(properties).sort(),
        [...expected.required_arguments, ...expected.optional_arguments].sort(),
        `${name} fields differ from the source contract`);
    }
    return discovered;
  }

  async call(call) {
    return this.rpc('tools/call', { name: call.name, arguments: call.arguments });
  }
}

function readPayload(response) {
  assert.ok(response.result && !response.error && response.result.isError !== true,
    'The native CRM read must succeed');
  const texts = response.result.content?.filter((item) => item.type === 'text');
  assert.ok(texts?.length === 1, 'A successful CRM read must have one JSON text result');
  return JSON.parse(texts[0].text);
}

function assertNativeFailure(response, marker) {
  assert.ok(response.error || response.result?.isError === true,
    'A denied or unavailable operation must fail explicitly, never return empty success');
  const error = response.error
    ? JSON.stringify(response.error)
    : response.result.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || '';
  assert.ok(error.includes(marker), 'The observed failure must match the recorded native failure type');
}

test('live tools/list distinguishes actual CRM read and write grants for Company A', { skip: !live }, async () => {
  const { fixture, readA, writeA } = await setupLiveClients();
  const reads = await readA.list();
  const writes = await writeA.list();
  assert.ok(reads.has(fixture.read_call.name), 'Company A read credential should discover its CRM read');
  assert.ok(!reads.has(fixture.write_tool), 'Company A read credential must not discover a write tool');
  assert.ok(writes.has(fixture.write_tool), 'Company A write credential should discover the authorized write');
});

test('live tool calls return the Company A CRM resource and deny a write with read scope', { skip: !live }, async () => {
  const { fixture, readA } = await setupLiveClients();
  assert.ok((await readA.list()).has(fixture.read_call.name), 'Fresh tools/list must expose the fixture read');
  const response = readPayload(await readA.call(fixture.read_call));
  assert.ok(response?.data?.id === fixture.read_call.expected_id, 'The returned CRM resource must match the private fixture');
  assertNativeFailure(await readA.call(fixture.denied_write_call), fixture.denied_write_failure.native_error_marker);
});

test('live Company B credentials cannot read the same private Company A CRM resource', { skip: !live }, async () => {
  const { fixture, readB } = await setupLiveClients();
  assert.ok((await readB.list()).has(fixture.read_call.name), 'Company B must have its own current CRM read grant');
  assertNativeFailure(await readB.call(fixture.read_call), fixture.cross_company_failure.native_error_marker);
});

test('live unavailable CRM provider is absent or returns its recorded native failure', { skip: !live }, async () => {
  const { fixture, writeA } = await setupLiveClients();
  const call = fixture.provider_unavailable.call;
  const visible = await writeA.list();
  if (!visible.has(call.name)) return;
  assertNativeFailure(await writeA.call(call), fixture.provider_unavailable.failure.native_error_marker);
});
