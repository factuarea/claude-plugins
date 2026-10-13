import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCrmSession } from '../../skills/factuarea-crm/scripts/crm-session.mjs';
import { JOURNEY_TOOLS, UUID, receipt } from './fixtures/catalogues.mjs';

const pluginContract = JSON.parse(readFileSync(new URL('../../docs/crm/contract.json', import.meta.url), 'utf8'));
const contractScopes = new Map(pluginContract.journey_examples.map(({ name, fine_scope_example }) => [name, fine_scope_example]));
const leadDraft = { name: 'Tenant B enquiry', source: 'manual', idempotency_key: 'tenant-b-lead-original' };

for (const tool of JOURNEY_TOOLS) {
  assert.ok(contractScopes.has(tool.name), `Mock tool ${tool.name} must be published by the CRM plugin contract`);
  assert.match(contractScopes.get(tool.name), /^crm_[a-z]+:(read|write)$/);
}

function providerFailure() {
  return Object.assign(new Error('local CRM provider unavailable'), {
    code: -32008,
    data: { http_status: 503, code: 'resource_unavailable', subcode: 'crm_lead_owner_unavailable' },
  });
}

/**
 * A local MCP callback fixture, not an OAuth/server integration. Identity and
 * grants live in this mock's connection closure, as they do in the host; they
 * are never tool arguments or plugin-managed credentials.
 */
function mockConnection({ company, scopes, tenantData, available = true }) {
  let providerAvailable = available;
  const calls = [];
  const listRequests = [];
  const unavailable = providerFailure();
  const grants = new Set(scopes);
  const tools = JOURNEY_TOOLS.filter((tool) => {
    return grants.has(contractScopes.get(tool.name));
  });

  async function toolcall(params) {
    calls.push(structuredClone(params));
    if (!providerAvailable) throw unavailable;

    const requiredScope = contractScopes.get(params.name);
    if (!requiredScope || !grants.has(requiredScope)) {
      throw Object.assign(new Error('Insufficient CRM scope'), {
        code: -32005,
        data: { http_status: 403, code: 'insufficient_scope', required_scope: requiredScope ?? 'unknown_tool' },
      });
    }

    const records = tenantData.get(company);
    if (params.name === 'find_lead') {
      const record = records.get(params.arguments.id);
      if (!record) {
        throw Object.assign(new Error('Lead unavailable'), {
          code: -32004,
          data: { http_status: 404, code: 'not_found' },
        });
      }
      return receipt(record);
    }

    if (params.name === 'create_lead') {
      const record = { id: UUID.activity, version: 1, name: params.arguments.name, business_contact_id: null };
      records.set(record.id, record);
      return receipt(record);
    }

    throw new Error(`No mock owner behavior for contract tool ${params.name}`);
  }

  const session = createCrmSession({
    listTools: async (params) => {
      listRequests.push(structuredClone(params));
      if (!providerAvailable) throw unavailable;
      return { tools };
    },
    callTool: toolcall,
  });

  return {
    session,
    calls,
    listRequests,
    toolcall,
    unavailable,
    setAvailable(value) { providerAvailable = value; },
  };
}

test('tools/list and toolcall enforce the contract scopes and each credential tenant context', async () => {
  const tenantData = new Map([
    ['company-a', new Map([[UUID.lead, { id: UUID.lead, version: 1, name: 'Tenant A lead' }]])],
    ['company-b', new Map()],
  ]);
  const readOnlyA = mockConnection({ company: 'company-a', scopes: ['crm_leads:read'], tenantData });
  const writeOnlyB = mockConnection({ company: 'company-b', scopes: ['crm_leads:write'], tenantData });
  const readOnlyB = mockConnection({ company: 'company-b', scopes: ['crm_leads:read'], tenantData });

  assert.deepEqual((await readOnlyA.session.discover()).map(({ name }) => name), ['find_lead']);
  assert.deepEqual((await writeOnlyB.session.discover()).map(({ name }) => name), ['create_lead']);
  assert.deepEqual((await readOnlyB.session.discover()).map(({ name }) => name), ['find_lead']);
  assert.deepEqual(readOnlyA.listRequests, [{}]);
  assert.deepEqual(writeOnlyB.listRequests, [{}]);
  assert.deepEqual(readOnlyB.listRequests, [{}]);

  const aLead = await readOnlyA.session.read('find_lead', { id: UUID.lead });
  assert.equal(aLead.structuredContent.data.name, 'Tenant A lead');
  await assert.rejects(readOnlyA.session.prepareWrite('create_lead', leadDraft), {
    reason: 'requested native tool is unavailable',
  });
  assert.equal(readOnlyA.calls.length, 1, 'the plugin preflight must not dispatch a hidden write');

  await assert.rejects(readOnlyA.toolcall({ name: 'create_lead', arguments: leadDraft }), (error) => {
    assert.equal(error.data.http_status, 403);
    assert.equal(error.data.code, 'insufficient_scope');
    assert.equal(error.data.required_scope, contractScopes.get('create_lead'));
    return true;
  });
  assert.equal(tenantData.get('company-a').has(UUID.activity), false, 'a direct tools/call cannot bypass the server scope check');

  await assert.rejects(readOnlyB.session.read('find_lead', { id: UUID.lead }), (error) => {
    assert.equal(error.data.http_status, 404);
    assert.equal(error.data.code, 'not_found');
    assert.equal(error.message.includes('Tenant A lead'), false);
    return true;
  });
  const created = await writeOnlyB.session.executeWrite(
    await writeOnlyB.session.prepareWrite('create_lead', leadDraft),
  );
  assert.equal(created.structuredContent.data.name, 'Tenant B enquiry');
  assert.deepEqual(readOnlyA.calls, [
    { name: 'find_lead', arguments: { id: UUID.lead } },
    { name: 'create_lead', arguments: leadDraft },
  ]);
  assert.deepEqual(writeOnlyB.calls, [
    { name: 'create_lead', arguments: leadDraft },
  ]);
  assert.equal(Object.hasOwn(writeOnlyB.calls[0].arguments, 'company_id'), false);
  assert.equal(tenantData.get('company-a').get(UUID.lead).name, 'Tenant A lead');
  assert.deepEqual([...tenantData.get('company-b').keys()], [UUID.activity]);
  assert.equal(tenantData.get('company-a').has(UUID.activity), false);
});

test('an unavailable provider fails current discovery without dispatch or stale inventory fallback', async () => {
  const provider = mockConnection({
    company: 'company-b',
    scopes: ['crm_leads:read', 'crm_leads:write'],
    tenantData: new Map([['company-b', new Map()]]),
  });
  assert.equal((await provider.session.discover()).some(({ name }) => name === 'create_lead'), true);

  provider.setAvailable(false);
  await assert.rejects(provider.session.prepareWrite('create_lead', leadDraft), (error) => error === provider.unavailable);
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(provider.listRequests, [{}, {}]);
});
