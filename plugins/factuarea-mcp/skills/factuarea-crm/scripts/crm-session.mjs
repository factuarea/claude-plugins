/**
 * CRM preflight for adapters using the host's existing Factuarea MCP connection.
 * No transport, credential store, OAuth flow, native catalogue or effect ledger.
 */
export class CrmPreflightError extends Error {
  constructor(reason) {
    super(`CRM preflight: ${reason}`);
    this.name = 'CrmPreflightError';
    this.reason = reason;
  }
}

function wireCopy(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(wireCopy);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wireCopy(item)]));
  }
  throw new CrmPreflightError('arguments must preserve JSON types');
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const signature = (value) => JSON.stringify(stable(value));

/**
 * listTools(params) and callTool(params) must belong to the same connected host
 * client. Bind invalidate() to reconnection, tools/list_changed and changes to
 * company, environment, consent or policy. The owner authorizes every call.
 */
export function createCrmSession({ listTools, callTool, maxPages = 1000 }) {
  if (typeof listTools !== 'function' || typeof callTool !== 'function') {
    throw new TypeError('Use tools/list and tools/call from the existing host connection');
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new TypeError('maxPages must be positive');

  let generation = 0;
  const prepared = new WeakMap();
  // Volatile one-shot protection only; no native effect state or durable claims.
  const dispatchedKeys = new Set();

  function invalidate() {
    generation += 1;
  }

  async function discover() {
    const started = generation;
    const names = new Map();
    const cursors = new Set();
    let cursor;
    try {
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const page = await listTools(cursor === undefined ? {} : { cursor });
        if (started !== generation) throw new CrmPreflightError('connection changed during discovery');
        if (!page || !Array.isArray(page.tools)) throw new CrmPreflightError('incomplete tools/list result');
        for (const tool of page.tools) {
          if (!tool || typeof tool.name !== 'string' || tool.name.length === 0 || tool.inputSchema?.type !== 'object') {
            throw new CrmPreflightError('invalid tool descriptor');
          }
          const copy = freeze(wireCopy(tool));
          const prior = names.get(copy.name);
          if (prior && signature(prior) !== signature(copy)) {
            throw new CrmPreflightError('tool descriptor changed during discovery');
          }
          if (!prior) names.set(copy.name, copy);
        }
        if (page.nextCursor === undefined) return Object.freeze([...names.values()]);
        if (typeof page.nextCursor !== 'string' || page.nextCursor.length === 0 || cursors.has(page.nextCursor)) {
          throw new CrmPreflightError('invalid or repeated tools/list cursor');
        }
        cursor = page.nextCursor;
        cursors.add(cursor);
      }
      throw new CrmPreflightError('discovery page budget exhausted; catalogue incomplete');
    } catch (error) {
      invalidate();
      throw error;
    }
  }

  async function currentTool(name) {
    const tool = (await discover()).find((item) => item.name === name);
    if (!tool) throw new CrmPreflightError('requested native tool is unavailable');
    return tool;
  }

  async function read(name, args = {}) {
    const payload = wireCopy(args);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new CrmPreflightError('tool arguments must be an object');
    }
    const started = generation;
    const tool = await currentTool(name);
    if (started !== generation) throw new CrmPreflightError('connection changed before the read');
    if (tool.annotations?.readOnlyHint !== true) throw new CrmPreflightError('tool is not declared read-only');
    try {
      return await callTool({ name, arguments: payload });
    } catch (error) {
      invalidate();
      throw error;
    }
  }

  async function prepareWrite(name, args) {
    if (name === 'create_client') throw new CrmPreflightError('client alias cannot capture a native lead');
    const payload = freeze(wireCopy(args));
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new CrmPreflightError('tool arguments must be an object');
    }
    const started = generation;
    const tool = await currentTool(name);
    if (started !== generation) throw new CrmPreflightError('connection changed before preparation');
    if (tool.annotations?.readOnlyHint === true) throw new CrmPreflightError('use read() for this tool');
    let key;
    if (Object.hasOwn(tool.inputSchema.properties ?? {}, 'idempotency_key')) {
      const intent = payload.idempotency_key;
      if (typeof intent !== 'string' || !/^[\x20-\x7e]{1,255}$/.test(intent)) {
        throw new CrmPreflightError('preserve one native idempotency_key for this intent');
      }
      key = JSON.stringify([name, intent]);
      if (dispatchedKeys.has(key)) throw new CrmPreflightError('intent already dispatched; reconcile with its owner');
    }
    const preview = Object.freeze({ name, arguments: payload, tool });
    prepared.set(preview, { generation, descriptor: signature(tool), key, state: 'prepared' });
    return preview;
  }

  async function executeWrite(preview) {
    const record = prepared.get(preview);
    if (!record || record.state !== 'prepared') throw new CrmPreflightError('write is not an unused prepared intent');
    // Reserve before asynchronous discovery so concurrent callers cannot send twice.
    record.state = 'checking';
    try {
      if (record.generation !== generation) throw new CrmPreflightError('prepared intent was invalidated');
      const tool = await currentTool(preview.name);
      if (record.generation !== generation || record.descriptor !== signature(tool)) {
        throw new CrmPreflightError('native tool changed; prepare again');
      }
      if (record.key && dispatchedKeys.has(record.key)) {
        throw new CrmPreflightError('intent already dispatched; reconcile with its owner');
      }
      if (record.key) dispatchedKeys.add(record.key);
      record.state = 'dispatched';
      const response = await callTool({ name: preview.name, arguments: wireCopy(preview.arguments) });
      // A returned MCP result can itself be pending or isError. Never synthesize confirmation.
      record.state = 'returned';
      return response;
    } catch (error) {
      record.state = record.state === 'dispatched' ? 'unconfirmed' : 'invalidated';
      invalidate();
      throw error;
    }
  }

  return Object.freeze({ discover, invalidate, read, prepareWrite, executeWrite });
}
