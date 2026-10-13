import { createCrmSession, CrmPreflightError } from './crm-session.mjs';

/** Local review errors retain a native result when its wire response was unusable. */
export class CrmJourneyError extends CrmPreflightError {
  constructor(reason, nativeResult) {
    super(reason);
    this.name = 'CrmJourneyError';
    if (nativeResult !== undefined) this.nativeResult = nativeResult;
  }
}

function copy(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) {
    throw new CrmJourneyError('preserve JSON values without cycles');
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CrmJourneyError('preserve plain JSON objects');
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = Array.from({ length: value.length }, (_, index) => copy(value[index], ancestors));
  } else {
    result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item, ancestors)]));
  }
  ancestors.delete(value);
  return result;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

const signature = (value) => JSON.stringify(sorted(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const version = (value) => Number.isSafeInteger(value) && value >= 1;
const roles = (value) => Array.isArray(value) && new Set(value).size === value.length
  && value.every((role) => ['customer', 'supplier', 'lead'].includes(role));

/** Parse the native Response::json envelope, never instructions embedded in text. */
function dataOf(result) {
  if (!object(result) || result.isError === true) return null;
  const candidates = [];
  if (object(result.structuredContent) && object(result.structuredContent.data)) {
    candidates.push(result.structuredContent.data);
  }
  for (const block of Array.isArray(result.content) ? result.content : []) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const decoded = JSON.parse(block.text);
      if (object(decoded?.data)) candidates.push(decoded.data);
    } catch {
      // Native data can coexist with prose. Prose grants no identity or authority.
    }
  }
  if (candidates.length === 0 || candidates.some((item) => signature(item) !== signature(candidates[0]))) return null;
  return candidates[0];
}

// Response contracts verified against the owning native tools/resources. This
// set permits receipt interpretation; it never advertises availability/grants.
const documentReceipts = new Set([
  'upload_commercial_document', 'replace_commercial_document_version',
  'share_commercial_document', 'revoke_commercial_document_share', 'archive_commercial_document',
]);
const identityReceipts = new Set([
  'create_lead', 'convert_lead', 'create_opportunity', 'create_crm_activity',
  'create_opportunity_quote', 'link_opportunity_document', 'unlink_opportunity_document',
  'move_service_ticket_to_stage', 'attach_service_ticket_document', 'detach_service_ticket_document',
]);

function identityOf(name, result) {
  if (!documentReceipts.has(name) && !identityReceipts.has(name)) return null;
  const data = dataOf(result);
  if (name === 'create_crm_activity') {
    if (!data || data.state !== 'confirmed' || !uuid(data.activity_id) || !uuid(data.effect_id)
      || data.activity_id === data.effect_id || !(data.activity === null
        || (object(data.activity) && data.activity.id === data.activity_id && version(data.activity.version)))) return null;
    return { id: data.activity_id, effectId: data.effect_id, immutableVersion: false };
  }
  if (!data || !uuid(data.id) || data.confirmed === false
    || ['pending', 'in_progress', 'unconfirmed'].includes(data.state)
    || ['pending', 'in_progress', 'unconfirmed'].includes(data.status)) return null;
  if (!version(data.version) && !(data.confirmed === true && data.representation_available === false)) return null;
  if (documentReceipts.has(name) && !version(data.version)) return null;
  return { id: data.id, version: data.version, immutableVersion: documentReceipts.has(name) };
}

function planOf(result, intent) {
  const plan = dataOf(result);
  if (!plan || plan.lead_id !== intent.id || plan.strategy !== intent.strategy
    || !version(plan.lead_version) || plan.lead_version > 4294967295
    || typeof plan.plan_hash !== 'string' || !/^[0-9a-f]{64}$/.test(plan.plan_hash)
    || !(plan.contact_id === null || uuid(plan.contact_id)) || !object(plan.normalized_draft)
    || !roles(plan.roles_before) || !roles(plan.roles_after) || !Array.isArray(plan.conflicts)) {
    throw new CrmJourneyError('native conversion preview is unavailable or incompatible', result);
  }
  return freeze(copy(plan));
}

/**
 * Uses only callbacks from the host's already connected Factuarea MCP client.
 * Bind invalidate() to tools/list_changed, reconnection, revoke and changes of
 * company, actor, environment or policy. The helper has no auth or durable store.
 */
export function createCrmJourney(host) {
  const ports = { listTools: host.listTools, callTool: host.callTool, maxPages: host.maxPages };
  const session = createCrmSession(ports);
  let epoch = 0;
  const reviews = new WeakMap();
  const effects = new WeakMap();

  function invalidate() {
    epoch += 1;
    session.invalidate();
  }

  function assertEpoch(started) {
    if (started !== epoch) throw new CrmJourneyError('host context changed; discard the prior review');
  }

  async function inspect(names) {
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name.length === 0)) {
      throw new CrmJourneyError('supply the native tool names needed by this step');
    }
    const tools = await session.discover();
    const requested = [...new Set(names)];
    return freeze({ visible: tools.filter((tool) => requested.includes(tool.name)),
      absent: requested.filter((name) => !tools.some((tool) => tool.name === name)) });
  }

  async function prepare(name, args, conversion = false) {
    if (name === 'convert_lead' && !conversion) throw new CrmJourneyError('review and confirm the native conversion plan first');
    const started = epoch;
    const preview = await session.prepareWrite(name, copy(args));
    assertEpoch(started);
    // Recovery must use the original native key; no client-side UUID fallback.
    if ((documentReceipts.has(name) || identityReceipts.has(name))
      && !Object.hasOwn(preview.tool.inputSchema.properties ?? {}, 'idempotency_key')) {
      throw new CrmJourneyError('the native original-intent contract is not published');
    }
    effects.set(preview, { epoch, state: 'prepared', identity: null });
    return preview;
  }

  async function execute(preview) {
    const effect = effects.get(preview);
    if (!effect || effect.state !== 'prepared') throw new CrmJourneyError('use one unused native preparation');
    assertEpoch(effect.epoch);
    effect.state = 'executing';
    try {
      const result = await session.executeWrite(preview);
      assertEpoch(effect.epoch);
      effect.identity = identityOf(preview.name, result);
      effect.state = effect.identity ? 'confirmed' : 'unconfirmed';
      return result;
    } catch (error) {
      effect.state = 'unconfirmed';
      throw error;
    }
  }

  /** Explicit recovery of a previously observed confirmed effect, never retry. */
  async function recoverConfirmed(preview) {
    const effect = effects.get(preview);
    if (!effect || effect.state !== 'confirmed') {
      throw new CrmJourneyError('uncertain effects require owner observation; do not resend');
    }
    assertEpoch(effect.epoch);
    effect.state = 'recovering';
    try {
      // A separate one-shot preflight permits exactly this confirmed receipt.
      // It shares the existing connection and has no OAuth/client registration.
      const current = createCrmSession({ ...ports,
        listTools: async (params) => {
          assertEpoch(effect.epoch);
          const page = await ports.listTools(params);
          assertEpoch(effect.epoch);
          return page;
        },
        callTool: async (params) => {
          assertEpoch(effect.epoch);
          return ports.callTool(params);
        },
      });
      const original = await current.prepareWrite(preview.name, copy(preview.arguments));
      if (signature(original.tool) !== signature(preview.tool)) {
        throw new CrmJourneyError('native receipt contract changed; inspect with its owner');
      }
      const result = await current.executeWrite(original);
      assertEpoch(effect.epoch);
      const recovered = identityOf(preview.name, result);
      if (recovered && (recovered.id !== effect.identity.id
        || recovered.effectId !== effect.identity.effectId
        || (effect.identity.immutableVersion && recovered.version !== effect.identity.version))) {
        throw new CrmJourneyError('native recovery did not preserve the original receipt', result);
      }
      effect.state = recovered ? 'confirmed' : 'unconfirmed';
      return result;
    } catch (error) {
      effect.state = 'recovery_failed';
      invalidate();
      throw error;
    }
  }

  async function reviewConversion(args) {
    const intent = freeze(copy(args));
    if (!object(intent) || !uuid(intent.id) || !['link_existing', 'create_contact'].includes(intent.strategy)
      || ['expected_version', 'plan_hash', 'confirmed', 'idempotency_key'].some((key) => Object.hasOwn(intent, key))) {
      throw new CrmJourneyError('supply an original native conversion preview intent');
    }
    const started = epoch;
    const result = await session.read('preview_lead_conversion', intent);
    assertEpoch(started);
    const plan = planOf(result, intent);
    const review = Object.freeze({ intent, plan });
    reviews.set(review, { epoch });
    return review;
  }

  async function prepareConversion(review, { confirmed, idempotencyKey } = {}) {
    const record = reviews.get(review);
    if (!record || confirmed !== true) throw new CrmJourneyError('explicit confirmation of this native review is required');
    assertEpoch(record.epoch);
    if (review.plan.conflicts.length !== 0) throw new CrmJourneyError('resolve native conversion conflicts before confirmation');
    // Re-read the exact intent. A changed plan requires a new user review; do
    // not silently replace its version, roles, draft, contact or hash.
    const result = await session.read('preview_lead_conversion', copy(review.intent));
    assertEpoch(record.epoch);
    const current = planOf(result, review.intent);
    if (signature(current) !== signature(review.plan)) throw new CrmJourneyError('native conversion plan changed; review again', result);
    return prepare('convert_lead', { ...copy(review.intent), expected_version: review.plan.lead_version,
      plan_hash: review.plan.plan_hash, confirmed: true, idempotency_key: idempotencyKey }, true);
  }

  async function currentDocument(id) {
    const started = epoch;
    const result = await session.read('get_commercial_document', { id });
    assertEpoch(started);
    const document = dataOf(result);
    if (!document || document.id !== id || !version(document.version)) {
      throw new CrmJourneyError('current native document representation is unavailable', result);
    }
    return document;
  }

  async function prepareDocumentGrant({ id, grantType, granteeId, expiresAt, idempotencyKey } = {}) {
    if (!uuid(id) || !uuid(granteeId) || !['user', 'team'].includes(grantType)) {
      throw new CrmJourneyError('use the native document, grantee UUID and explicit grant type');
    }
    const started = epoch;
    const document = await currentDocument(id);
    assertEpoch(started);
    const args = { id, expected_version: document.version, grant_type: grantType, grantee_id: granteeId,
      idempotency_key: idempotencyKey };
    if (expiresAt !== undefined) args.expires_at = expiresAt;
    return prepare('share_commercial_document', args);
  }

  async function prepareDocumentRevocation({ id, shareId, idempotencyKey } = {}) {
    const started = epoch;
    const document = await currentDocument(id);
    assertEpoch(started);
    // A document receipt ID is not a share ID. Current masking may omit shares.
    if (!uuid(shareId) || !Array.isArray(document.shares)
      || !document.shares.some((share) => share.id === shareId && share.revoked_at === null)) {
      throw new CrmJourneyError('the selected active native share is not currently visible');
    }
    return prepare('revoke_commercial_document_share', { id, expected_version: document.version,
      share_id: shareId, idempotency_key: idempotencyKey });
  }

  return Object.freeze({ inspect, invalidate, read: session.read,
    prepare: (name, args) => prepare(name, args), execute, recoverConfirmed,
    reviewConversion, prepareConversion, prepareDocumentGrant, prepareDocumentRevocation });
}
