// Real-server harness only. No mock server, auth, Company selection or write execution.
// Operator-owned fixture is mandatory; no fixture credentials or IDs are shipped.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateDiscoveryFixture } from './discovery-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(await readFile(path.join(root, 'plugin-contract.json'), 'utf8'));
const live = process.env.FACTUAREA_CRM_LIVE === '1';
let prepared;

async function setup() {
  if (prepared) return prepared;
  const filename = process.env.FACTUAREA_CRM_FIXTURE;
  assert.ok(filename, 'A private fixture from actual native resources is required');
  const mode = (await stat(filename)).mode & 0o777;
  assert.equal(mode, 0o600, 'Fixture must have mode 0600');
  const fixture = JSON.parse(await readFile(filename, 'utf8'));
  const credentials = validateDiscoveryFixture(fixture, contract);
  const clients = [];
  const seenTokens = new Set();
  // Resolve and distinguish all credentials before the first network operation.
  const tokens = credentials.map((credential) => {
    const token = process.env[credential.token_env];
    assert.ok(typeof token === 'string' && token.length > 0, 'Actual credential must be provided via its private environment');
    assert.ok(!seenTokens.has(token), 'Read/write and Companies A/B need distinct native credentials');
    seenTokens.add(token);
    return token;
  });
  for (const token of tokens) {
    const client = new NativeMcpClient(token, fixture.protocol_version);
    await client.initialize();
    clients.push(client);
  }
  prepared = { fixture, readA: clients[0], writeA: clients[1], readB: clients[2] };
  return prepared;
}

class NativeMcpClient {
  #token;
  #session;
  #protocol;
  #nextId = 0;

  constructor(token, protocol) {
    this.#token = token;
    this.#protocol = protocol;
  }

  async rpc(method, params, notification = false) {
    const id = ++this.#nextId;
    const headers = { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.#protocol };
    if (this.#session) headers['Mcp-Session-Id'] = this.#session;
    const body = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
    const response = await fetch(contract.server.url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (notification && response.status === 202) return null;
    assert.equal(response.ok, true, `Actual MCP transport failed with HTTP ${response.status}; not empty data`);
    const session = response.headers.get('mcp-session-id');
    if (session) {
      assert.ok(!this.#session || this.#session === session, 'Native MCP session changed');
      this.#session = session;
    }
    const text = await response.text();
    let message;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      const messages = text.split(/\r?\n\r?\n/).flatMap((event) => {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        return data ? [JSON.parse(data)] : [];
      });
      message = messages.find((item) => item.id === id);
    } else {
      message = JSON.parse(text);
    }
    assert.ok(message && message.id === id && message.jsonrpc === '2.0', 'Actual native JSON-RPC response required');
    return message;
  }

  async initialize() {
    const response = await this.rpc('initialize', { protocolVersion: this.#protocol, capabilities: {}, clientInfo: { name: contract.package, version: contract.package_version } });
    assert.ok(response.result && !response.error, 'MCP initialization did not succeed');
    assert.ok(response.result.capabilities?.tools, 'Native MCP tools capability required');
    assert.equal(response.result.protocolVersion, this.#protocol, 'Use a protocol supported by the actual server; no fallback negotiation invented');
    await this.rpc('notifications/initialized', {}, true);
  }

  async list() {
    const discovered = new Map();
    const cursors = new Set();
    let cursor;
    do {
      const response = await this.rpc('tools/list', cursor ? { cursor } : {});
      assert.ok(response.result && !response.error && Array.isArray(response.result.tools), 'Actual tools/list required');
      for (const tool of response.result.tools) {
        assert.ok(typeof tool.name === 'string' && tool.inputSchema?.type === 'object', 'Native tool name/schema required');
        assert.ok(!discovered.has(tool.name), 'Duplicate discovery name');
        discovered.set(tool.name, tool);
      }
      cursor = response.result.nextCursor;
      if (cursor) {
        assert.ok(typeof cursor === 'string' && !cursors.has(cursor), 'Use only actual advancing cursor');
        cursors.add(cursor);
      }
    } while (cursor);
    return discovered;
  }

  async call(call) {
    return this.rpc('tools/call', { name: call.name, arguments: call.arguments });
  }
}

function payload(response) {
  assert.ok(response.result && !response.error && response.result.isError !== true, 'Actual native read must succeed');
  const texts = response.result.content?.filter((item) => item.type === 'text');
  assert.ok(texts?.length === 1, 'Exactly one native JSON resource response required');
  return JSON.parse(texts[0].text);
}

function nativeFailure(response, expected) {
  assert.ok(response.error || response.result?.isError === true, 'Denial/unavailable must be explicit, never a successful empty result');
  const error = response.error ? JSON.stringify(response.error) : response.result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  assert.ok(error.includes(expected.native_error_marker), 'Expected the typed native failure, not another parse/validation error');
}

test('real authenticated tools/list distinguishes read and write grants, including original WRITE queries', { skip: !live }, async () => {
  const { fixture, readA, writeA } = await setup();
  const reads = await readA.list();
  const writes = await writeA.list();
  assert.ok(reads.has(fixture.read_call.name), 'Actual native read tool should be available');
  assert.ok(writes.has(fixture.write_tool), 'Actual qualified native write tool should be available');
  for (const tool of contract.tools.filter((item) => item.scope.endsWith(':write') || item.scope.endsWith(':delete'))) {
    assert.ok(!reads.has(tool.name), 'READ credential cannot discover writer privilege, even for original queries');
  }
});

test('real toolcall returns the actual Company A resource and never mutates with read scope', { skip: !live }, async () => {
  const { fixture, readA } = await setup();
  const visible = await readA.list();
  assert.ok(visible.has(fixture.read_call.name));
  // Each test can run independently; refuse the denial probe if discovery
  // already reveals that the intended read credential has writer privilege.
  for (const tool of contract.tools.filter((item) => item.scope.endsWith(':write') || item.scope.endsWith(':delete'))) {
    assert.ok(!visible.has(tool.name), 'Read credential exposes writer privilege; refuse the denial probe');
  }
  assert.equal(payload(await readA.call(fixture.read_call)).data.id, fixture.read_call.expected_id);
  nativeFailure(await readA.call(fixture.denied_write_call), fixture.denied_write_failure);
});

test('Company B actual credential cannot read the same Company A private resource', { skip: !live }, async () => {
  const { fixture, readB } = await setup();
  nativeFailure(await readB.call(fixture.read_call), fixture.cross_company_failure);
});

test('an actually unavailable provider is absent or a typed failure, never fabricated empty data', { skip: !live }, async () => {
  const { fixture, writeA } = await setup();
  const call = fixture.provider_unavailable.call;
  const visible = await writeA.list();
  if (!visible.has(call.name)) return;
  nativeFailure(await writeA.call(call), fixture.provider_unavailable.failure);
});
