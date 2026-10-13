import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createCrmJourney, CrmJourneyError } from '../../skills/factuarea-crm/scripts/crm-journey.mjs';
import { CONVERSION_TOOLS, DOCUMENT_TOOLS, DOCUMENT_ARGUMENTS, JOURNEY_TOOLS, UUID, PRESERVE_INTENT,
  conversionPlan, nativeDocument, receipt } from './fixtures/continuity.mjs';

function connected({ tools = [...CONVERSION_TOOLS, ...DOCUMENT_TOOLS, ...JOURNEY_TOOLS], handle } = {}) {
  const calls = [];
  const lists = [];
  let catalogue = tools;
  const ports = {
    listTools: async (params) => { lists.push(structuredClone(params)); return { tools: catalogue }; },
    callTool: async (params) => {
      calls.push(structuredClone(params));
      if (handle) return handle(params, calls);
      if (params.name === 'preview_lead_conversion') return receipt(conversionPlan(params.arguments));
      if (params.name === 'get_commercial_document') return receipt(nativeDocument());
      return receipt({ id: params.name === 'convert_lead' ? UUID.lead : UUID.document, version: 18 });
    },
  };
  return { crm: createCrmJourney(ports), calls, lists, ports,
    setTools: (value) => { catalogue = value; } };
}

const share = { id: UUID.document, expected_version: 17, grant_type: 'team',
  grantee_id: UUID.stage, expires_at: null, idempotency_key: 'share-original' };
const conversionOptions = { confirmed: true, idempotencyKey: 'conversion-original' };

test('host-native discovery reports only currently visible requested tools, with no grant inference', async () => {
  const current = connected({ tools: [CONVERSION_TOOLS[0], DOCUMENT_TOOLS[0]] });
  const first = await current.crm.inspect(['preview_lead_conversion', 'convert_lead', 'share_commercial_document']);
  assert.deepEqual(first.visible.map((tool) => tool.name), ['preview_lead_conversion']);
  assert.deepEqual(first.absent, ['convert_lead', 'share_commercial_document']);
  assert(!Object.hasOwn(first, 'grants'));
  current.setTools(CONVERSION_TOOLS);
  const fresh = await current.crm.inspect(['convert_lead']);
  assert.equal(fresh.visible[0].name, 'convert_lead');
  assert.deepEqual(fresh.absent, []);
  assert.equal(current.calls.length, 0);
});

test('conversion preserves the native dual-role plan and original intent through explicit confirmation', async () => {
  const current = connected();
  const intent = { ...PRESERVE_INTENT };
  const review = await current.crm.reviewConversion(intent);
  intent.role_action = 'assign';
  assert.deepEqual(review.plan.roles_before, ['customer', 'supplier']);
  assert.deepEqual(review.plan.roles_after, ['customer', 'supplier']);
  assert(Object.isFrozen(review.plan.normalized_draft));
  const prepared = await current.crm.prepareConversion(review, conversionOptions);
  assert.deepEqual(prepared.arguments, { ...PRESERVE_INTENT, expected_version: 7,
    plan_hash: 'a'.repeat(64), confirmed: true, idempotency_key: 'conversion-original' });
  assert.equal(current.calls.filter((call) => call.name === 'preview_lead_conversion').length, 2);
  await current.crm.execute(prepared);
  assert.deepEqual(current.calls.at(-1), { name: 'convert_lead', arguments: prepared.arguments });
  assert(!Object.hasOwn(prepared.arguments, 'role'));
  assert(!Object.hasOwn(prepared.arguments, 'activate_existing'));
});

test('create_contact uses explicit native roles without adding customer or fiscal identity', async () => {
  const current = connected();
  const intent = { id: UUID.lead, strategy: 'create_contact', contact: { name: 'Prefiscal example', roles: [] } };
  const review = await current.crm.reviewConversion(intent);
  const prepared = await current.crm.prepareConversion(review, conversionOptions);
  assert.deepEqual(prepared.arguments.contact, intent.contact);
  assert.deepEqual(prepared.arguments.contact.roles, []);
  assert(!Object.hasOwn(prepared.arguments.contact, 'tax_id'));
  assert.equal(prepared.arguments.strategy, 'create_contact');
});

test('false, missing and string confirmations never prepare or send conversion', async () => {
  const current = connected();
  const review = await current.crm.reviewConversion(PRESERVE_INTENT);
  for (const confirmed of [undefined, false, 'true', 1]) {
    await assert.rejects(current.crm.prepareConversion(review, { confirmed, idempotencyKey: 'original' }),
      (error) => error instanceof CrmJourneyError && error.reason.includes('explicit confirmation'));
  }
  assert.equal(current.calls.length, 1);
});

test('a changed version, hash, destination, role or normalized draft requires another review', async () => {
  for (const changed of [{ lead_version: 8 }, { plan_hash: 'b'.repeat(64) }, { contact_id: UUID.ticket },
    { roles_after: ['customer', 'supplier', 'lead'] }, { normalized_draft: { name: 'changed' } }]) {
    let previews = 0;
    const current = connected({ handle: ({ arguments: args }) =>
      receipt(conversionPlan(args, previews++ === 0 ? {} : changed)) });
    const review = await current.crm.reviewConversion(PRESERVE_INTENT);
    await assert.rejects(current.crm.prepareConversion(review, conversionOptions),
      (error) => error.reason.includes('plan changed') && error.nativeResult !== undefined);
    assert.equal(current.calls.filter((call) => call.name === 'convert_lead').length, 0);
  }
});

test('native conversion conflicts remain visible and block preparation', async () => {
  const conflicts = [{ field: 'business_contact_id', code: 'unavailable' }];
  const current = connected({ handle: ({ arguments: args }) => receipt(conversionPlan(args, { conflicts })) });
  const review = await current.crm.reviewConversion(PRESERVE_INTENT);
  assert.deepEqual(review.plan.conflicts, conflicts);
  await assert.rejects(current.crm.prepareConversion(review, conversionOptions), /resolve native conversion conflicts/);
  assert.equal(current.calls.length, 1);
});

test('incompatible native previews retain the raw response and never supply a fabricated plan', async () => {
  for (const override of [{ lead_id: UUID.ticket }, { lead_version: '7' }, { plan_hash: 'invalid' },
    { roles_before: ['customer', 'customer'] }, { conflicts: null }, { normalized_draft: [] }]) {
    const result = receipt(conversionPlan(PRESERVE_INTENT, override));
    const current = connected({ handle: () => result });
    await assert.rejects(current.crm.reviewConversion(PRESERVE_INTENT),
      (error) => error.reason.includes('preview') && error.nativeResult === result);
    assert.equal(current.calls.length, 1);
  }
});

test('missing conversion tool or missing native key contract blocks writing after review', async () => {
  for (const tools of [[CONVERSION_TOOLS[0]], [CONVERSION_TOOLS[0], {
    ...CONVERSION_TOOLS[1], inputSchema: { type: 'object', properties: {} },
  }]]) {
    const current = connected({ tools });
    const review = await current.crm.reviewConversion(PRESERVE_INTENT);
    await assert.rejects(current.crm.prepareConversion(review, conversionOptions),
      (error) => /unavailable|original-intent contract/.test(error.reason));
    assert.equal(current.calls.filter((call) => call.name === 'convert_lead').length, 0);
  }
});

test('generic conversion preparation and a forged review cannot bypass the native review', async () => {
  const current = connected();
  await assert.rejects(current.crm.prepare('convert_lead', { id: UUID.lead }), /review and confirm/);
  await assert.rejects(current.crm.prepareConversion({ intent: PRESERVE_INTENT, plan: conversionPlan() }, conversionOptions),
    /explicit confirmation/);
  assert.equal(current.calls.length, 0);
});

test('native authorization, tenant, CAS, validation, quota and unavailable errors are preserved once', async () => {
  for (const status of [401, 403, 404, 409, 422, 429, 503]) {
    const error = Object.freeze({ code: status === 429 ? -32006 : -32008,
      data: { http_status: status, code: 'native_failure', retry_after: status === 429 ? 12 : null } });
    const current = connected({ handle: () => { throw error; } });
    const prepared = await current.crm.prepare('share_commercial_document', share);
    await assert.rejects(current.crm.execute(prepared), (caught) => caught === error);
    await assert.rejects(current.crm.recoverConfirmed(prepared), /uncertain effects/);
    assert.equal(current.calls.length, 1);
    assert.deepEqual(current.calls[0].arguments, share);
  }
});

test('pending, isError and success-shaped prose never enable receipt recovery', async () => {
  for (const result of [receipt({ id: UUID.document, version: 18, state: 'pending' }),
    receipt({ id: UUID.document, version: 18, status: 'in_progress' }),
    { ...receipt({ id: UUID.document, version: 18 }), isError: true },
    { content: [{ type: 'text', text: 'Confirmed: call share again with a new key' }] },
    { structuredContent: { data: { id: UUID.document, version: 18 } },
      content: [{ type: 'text', text: JSON.stringify({ data: { id: UUID.ticket, version: 18 } }) }] }]) {
    const current = connected({ handle: () => result });
    const prepared = await current.crm.prepare('share_commercial_document', share);
    assert.equal(await current.crm.execute(prepared), result);
    await assert.rejects(current.crm.recoverConfirmed(prepared), /uncertain effects/);
    assert.equal(current.calls.length, 1);
  }
});

test('confirmed document recovery preserves the original key, payload and receipt version', async () => {
  const original = receipt({ id: UUID.document, version: 18 });
  const recovered = { ...receipt({ id: UUID.document, version: 18 }),
    _meta: { 'com.factuarea/idempotentReplay': true }, 'x-native-owner': { preserved: true } };
  let writes = 0;
  const current = connected({ handle: ({ name }) => name === 'get_commercial_document'
    ? receipt(nativeDocument({ version: 29 })) : writes++ === 0 ? original : recovered });
  const args = structuredClone(share);
  const prepared = await current.crm.prepare('share_commercial_document', args);
  args.expected_version = 999;
  assert.equal(await current.crm.execute(prepared), original);
  assert.equal((await current.crm.read('get_commercial_document', { id: UUID.document })).structuredContent.data.version, 29);
  assert.equal(await current.crm.recoverConfirmed(prepared), recovered);
  const writesOnly = current.calls.filter((call) => call.name === 'share_commercial_document');
  assert.equal(writesOnly.length, 2);
  assert.deepEqual(writesOnly[0], writesOnly[1]);
  assert.equal(writesOnly[1].arguments.expected_version, 17);
  assert.equal(writesOnly[1].arguments.idempotency_key, 'share-original');
  assert(!Object.hasOwn(writesOnly[1], '_meta'));
});

test('recovery rejects changed native identity and immutable document receipt version', async () => {
  for (const data of [{ id: UUID.ticket, version: 18 }, { id: UUID.document, version: 29 }]) {
    let writes = 0;
    const result = receipt(data);
    const current = connected({ handle: () => writes++ === 0 ? receipt({ id: UUID.document, version: 18 }) : result });
    const prepared = await current.crm.prepare('share_commercial_document', share);
    await current.crm.execute(prepared);
    await assert.rejects(current.crm.recoverConfirmed(prepared),
      (error) => error.reason.includes('original receipt') && error.nativeResult === result);
    assert.equal(current.calls.length, 2);
  }
});

test('context invalidation discards original effect tokens before recovery or execution', async () => {
  const current = connected();
  const prepared = await current.crm.prepare('share_commercial_document', share);
  await current.crm.execute(prepared);
  current.crm.invalidate();
  await assert.rejects(current.crm.recoverConfirmed(prepared), /host context changed/);
  const next = await current.crm.prepare('archive_commercial_document', {
    id: UUID.document, expected_version: 18, idempotency_key: 'archive-new-intent' });
  current.crm.invalidate();
  await assert.rejects(current.crm.execute(next), /host context changed/);
  assert.equal(current.calls.length, 1);
});

test('current discovery absence or full descriptor drift prevents confirmed recovery', async () => {
  for (const mutate of [() => [], (tools) => tools.map((tool) => tool.name === 'share_commercial_document'
    ? { ...tool, 'x-native-extension': { contractVersion: 2 } } : tool)]) {
    const current = connected();
    const prepared = await current.crm.prepare('share_commercial_document', share);
    await current.crm.execute(prepared);
    current.setTools(mutate(DOCUMENT_TOOLS));
    await assert.rejects(current.crm.recoverConfirmed(prepared),
      (error) => /unavailable|contract changed/.test(error.reason));
    assert.equal(current.calls.length, 1);
  }
});

test('concurrent recovery sends one original invocation and does not schedule retries', async () => {
  const current = connected();
  const prepared = await current.crm.prepare('share_commercial_document', share);
  await current.crm.execute(prepared);
  const first = current.crm.recoverConfirmed(prepared);
  await assert.rejects(current.crm.recoverConfirmed(prepared), /uncertain effects/);
  await first;
  assert.equal(current.calls.length, 2);
});

test('an unfamiliar write contract cannot gain recovery merely from an id and version', async () => {
  const custom = { ...CONVERSION_TOOLS[1], name: 'new_native_operation' };
  const current = connected({ tools: [custom] });
  const prepared = await current.crm.prepare(custom.name, { id: UUID.document, idempotency_key: 'new-original' });
  await current.crm.execute(prepared);
  await assert.rejects(current.crm.recoverConfirmed(prepared), /uncertain effects/);
  assert.equal(current.calls.length, 1);
});

test('confirmed identity without representation permits original Lead recovery without cached PII', async () => {
  let conversions = 0;
  const identityOnly = receipt({ id: UUID.lead, confirmed: true, representation_available: false });
  const current = connected({ handle: ({ name, arguments: args }) => name === 'preview_lead_conversion'
    ? receipt(conversionPlan(args)) : conversions++ === 0
      ? receipt({ id: UUID.lead, version: 8, name: 'Original private name' }) : identityOnly });
  const review = await current.crm.reviewConversion(PRESERVE_INTENT);
  const prepared = await current.crm.prepareConversion(review, conversionOptions);
  await current.crm.execute(prepared);
  assert.equal(await current.crm.recoverConfirmed(prepared), identityOnly);
  assert(!JSON.stringify(identityOnly).includes('Original private name'));
  const conversionCalls = current.calls.filter((call) => call.name === 'convert_lead');
  assert.deepEqual(conversionCalls[0], conversionCalls[1]);
});

test('document grant preparation reads current CAS and keeps user-selected scope and null', async () => {
  const current = connected();
  const prepared = await current.crm.prepareDocumentGrant({ id: UUID.document, grantType: 'team',
    granteeId: UUID.stage, expiresAt: null, idempotencyKey: 'share-original' });
  assert.deepEqual(prepared.arguments, share);
  assert.deepEqual(current.calls, [{ name: 'get_commercial_document', arguments: { id: UUID.document } }]);
  await current.crm.execute(prepared);
  assert.deepEqual(current.calls.at(-1), { name: 'share_commercial_document', arguments: share });
});

test('document grant cannot be offered by a read-only catalogue or mismatched native record', async () => {
  for (const options of [{ tools: DOCUMENT_TOOLS.filter((tool) => tool.annotations.readOnlyHint) },
    { handle: () => receipt(nativeDocument({ id: UUID.ticket })) }]) {
    const current = connected(options);
    await assert.rejects(current.crm.prepareDocumentGrant({ id: UUID.document, grantType: 'team',
      granteeId: UUID.stage, idempotencyKey: 'share-original' }));
    assert.equal(current.calls.filter((call) => call.name === 'share_commercial_document').length, 0);
  }
});

test('document revocation uses the visible active share identity, never the document receipt id', async () => {
  const current = connected();
  const prepared = await current.crm.prepareDocumentRevocation({ id: UUID.document,
    shareId: UUID.link, idempotencyKey: 'revoke-original' });
  assert.deepEqual(prepared.arguments, { id: UUID.document, expected_version: 17,
    share_id: UUID.link, idempotency_key: 'revoke-original' });
  const masked = nativeDocument();
  delete masked.shares;
  for (const document of [nativeDocument({ shares: [] }), masked,
    nativeDocument({ shares: [{ id: UUID.link, revoked_at: '2026-10-09T00:00:00Z' }] })]) {
    const blocked = connected({ handle: () => receipt(document) });
    await assert.rejects(blocked.crm.prepareDocumentRevocation({ id: UUID.document,
      shareId: UUID.link, idempotencyKey: 'revoke-original' }), /not currently visible/);
    assert.equal(blocked.calls.length, 1);
  }
  await assert.rejects(current.crm.prepareDocumentRevocation({ id: UUID.document,
    shareId: UUID.document, idempotencyKey: 'wrong-receipt-id' }), /not currently visible/);
});

test('native Opportunity document and ticket receipts retain separate UUIDs and CAS on recovery', async () => {
  const names = ['create_opportunity_quote', 'link_opportunity_document', 'unlink_opportunity_document',
    'move_service_ticket_to_stage', 'attach_service_ticket_document', 'detach_service_ticket_document'];
  for (const name of names) {
    const args = DOCUMENT_ARGUMENTS[name];
    const data = name.includes('service_ticket') ? { id: UUID.ticket, version: 8 }
      : { id: UUID.link, version: 3, opportunity_id: UUID.opportunity,
        document_type: 'quote', document_id: UUID.document, document: null };
    const result = receipt(data);
    const current = connected({ handle: () => result });
    const prepared = await current.crm.prepare(name, args);
    assert.equal(await current.crm.execute(prepared), result);
    assert.equal(await current.crm.recoverConfirmed(prepared), result);
    assert.deepEqual(current.calls[0], current.calls[1]);
    assert.deepEqual(current.calls[1].arguments, args);
    assert.equal(current.calls[1].arguments.idempotency_key, args.idempotency_key);
  }
});

test('Activity recovery consumes its native state, activity and effect identities, including a masked representation', async () => {
  let writes = 0;
  const original = receipt({ state: 'confirmed', activity_id: UUID.activity,
    effect_id: UUID.producer, activity: { id: UUID.activity, version: 1, title: 'Private note' } });
  const masked = receipt({ state: 'confirmed', activity_id: UUID.activity,
    effect_id: UUID.producer, activity: null });
  const current = connected({ handle: () => writes++ === 0 ? original : masked });
  const prepared = await current.crm.prepare('create_crm_activity', {
    type: 'note', title: 'Example note', target: { type: 'opportunity', id: UUID.opportunity },
    timezone: 'Europe/Madrid', idempotency_key: 'activity-original' });
  assert.equal(await current.crm.execute(prepared), original);
  assert.equal(await current.crm.recoverConfirmed(prepared), masked);
  assert.deepEqual(current.calls[0], current.calls[1]);
  assert(!JSON.stringify(masked).includes('Private note'));
  for (const data of [{ id: UUID.activity, version: 1 },
    { state: 'pending', activity_id: UUID.activity, effect_id: UUID.producer, activity: null },
    { state: 'confirmed', activity_id: UUID.activity, effect_id: UUID.activity, activity: null }]) {
    const blocked = connected({ handle: () => receipt(data) });
    const preparation = await blocked.crm.prepare('create_crm_activity', prepared.arguments);
    await blocked.crm.execute(preparation);
    await assert.rejects(blocked.crm.recoverConfirmed(preparation), /uncertain effects/);
    assert.equal(blocked.calls.length, 1);
  }
});

test('observing an uncertain owner result does not confirm the intent or allow key reuse', async () => {
  const current = connected({ handle: ({ name }) => name === 'get_commercial_document'
    ? receipt(nativeDocument({ version: 29 })) : receipt({ state: 'pending' }) });
  const prepared = await current.crm.prepare('share_commercial_document', share);
  await current.crm.execute(prepared);
  await current.crm.read('get_commercial_document', { id: UUID.document });
  await assert.rejects(current.crm.recoverConfirmed(prepared), /uncertain effects/);
  await assert.rejects(current.crm.prepare('share_commercial_document', { ...share, expected_version: 29 }), /already dispatched/);
  assert.equal(current.calls.length, 2);
});

test('recovery rechecks the native owner and returns revoked error without original cached data', async () => {
  let writes = 0;
  const revoked = Object.freeze({ code: -32002, data: { http_status: 403, code: 'revoked' } });
  const current = connected({ handle: () => {
    if (writes++ === 0) return receipt({ id: UUID.document, version: 18 });
    throw revoked;
  } });
  const prepared = await current.crm.prepare('share_commercial_document', share);
  await current.crm.execute(prepared);
  await assert.rejects(current.crm.recoverConfirmed(prepared), (caught) => caught === revoked);
  await assert.rejects(current.crm.recoverConfirmed(prepared), /uncertain effects/);
  assert.equal(current.calls.length, 2);
});

test('Claude command loads the canonical skill and new instructions while retaining one host-managed server', () => {
  const command = readFileSync(new URL('../../commands/crm-continue.md', import.meta.url), 'utf8');
  assert(command.includes('${CLAUDE_PLUGIN_ROOT}/skills/factuarea-crm/SKILL.md'));
  assert(command.includes('${CLAUDE_PLUGIN_ROOT}/skills/factuarea-crm/references/continuity.md'));
  const connection = JSON.parse(readFileSync(new URL('../../.mcp.json', import.meta.url), 'utf8'));
  assert.deepEqual(connection, { mcpServers: { factuarea: { type: 'http', url: 'https://mcp.factuarea.com' } } });
  const guide = readFileSync(new URL('../../docs/crm/continuity.md', import.meta.url), 'utf8');
  assert(guide.includes('SSH-CRM-006'));
  assert(guide.includes('SSH-CRM-008'));
  assert(guide.includes('permanecen pendientes'));
});
