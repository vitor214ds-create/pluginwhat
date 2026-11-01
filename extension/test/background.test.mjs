import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_KEY } from '../core.js';

const events = {};
function event(name) { return { addListener(fn) { events[name] = fn; } }; }
const local = {}, session = {}, alarms = new Map(), updates = [];
const storage = object => ({
  async get(key) { return structuredClone({ [key]: object[key] }); },
  async set(value) { Object.assign(object, structuredClone(value)); },
  async remove(keys) { for (const key of keys) delete object[key]; }
});
globalThis.chrome = {
  runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: event('message'), onStartup: event('startup') },
  storage: { local: storage(local), session: storage(session) },
  alarms: { async clear(name) { alarms.delete(name); }, async create(name, options) { alarms.set(name, options); }, onAlarm: event('alarm') },
  tabs: { async get(id) { if (!Number.isInteger(id)) throw new Error('closed'); return { id, url: 'https://web.whatsapp.com/' }; },
    async update(id, options) { updates.push({ id, ...options }); }, async sendMessage() { return { ready: true }; },
    onRemoved: event('removed'), onUpdated: event('updated'), async create() {}, async reload() {} },
  action: { onClicked: event('clicked') }
};
const { handle, exclusive } = await import('../background.js');
await exclusive(async () => {});
const panel = { id: 'test', url: 'chrome-extension://test/panel.html', tab: { id: 7 }, frameId: 1 };
const content = { id: 'test', url: 'https://web.whatsapp.com/send', tab: { id: 7 }, frameId: 0, documentId: 'doc-A' };
const config = { contacts: ['5511912345678', '5521912345678'], messages: ['a', 'b', 'c'], intervalSeconds: 90 };
const call = (type, extra = {}, sender = panel) => exclusive(() => handle({ type, ...extra }, sender));
const flush = () => exclusive(async () => {});
const state = () => local[STATE_KEY];
async function open() {
  delete local[STATE_KEY]; updates.length = 0;
  await call('START', { config });
  // The public listener dispatches a start after replying; simulate its alarm here.
  events.alarm({ name: 'pluginwhat-next' }); await flush();
  return call('CONTENT_READY', { initialUrl: updates[0].url }, content);
}

test('only the bound tab, initial navigation token and current document may authorize a click', async () => {
  await open();
  const jobId = state().job.id;
  await assert.rejects(call('PREPARED', { jobId }, { ...content, tab: { id: 8 } }), /cancelado/);
  await assert.rejects(call('PREPARED', { jobId }, { ...content, documentId: 'stale' }), /cancelado/);
  await assert.rejects(call('PREPARED', { jobId }, { ...content, frameId: 1 }), /cancelado/);
  await call('PREPARED', { jobId }, content);
  await assert.rejects(call('PREPARED', { jobId }, content), /cancelado/);
  assert.equal(state().job.phase, 'sending'); assert.equal(updates.length, 1);
});
test('two simultaneous START commands cannot create overlapping campaigns', async () => {
  delete local[STATE_KEY];
  const results = await Promise.allSettled([call('START', { config }), call('START', { config })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
test('a successful ack advances once and the alarm does not navigate before the interval', async () => {
  await open(); const jobId = state().job.id;
  await call('PREPARED', { jobId }, content);
  const now = Date.now(); await call('RESULT', { jobId, success: true }, content);
  assert.equal(state().cursor, 1); assert.equal(state().queue[0].status, 'sent');
  assert.ok(state().nextAt >= now + 90000);
  events.alarm({ name: 'pluginwhat-next' }); await flush();
  assert.equal(updates.length, 1);
  await assert.rejects(call('RESULT', { jobId, success: true }, content), /cancelado/);
});
test('closing a tab during a click records uncertainty and blocks resume', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  events.removed(7); await flush();
  assert.equal(state().status, 'paused'); assert.equal(state().queue[0].status, 'uncertain');
  await assert.rejects(call('RESUME'), /Confira/);
  await call('RESOLVE', { resolution: 'skipped' }); await call('RESUME');
  assert.equal(state().cursor, 1); assert.equal(state().queue[1].template, 1);
});
test('timeout after click pauses instead of retrying a potentially sent message', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  local[STATE_KEY].job.deadline = 0;
  events.alarm({ name: 'pluginwhat-next' }); await flush();
  assert.equal(state().status, 'paused'); assert.equal(state().queue[0].status, 'uncertain'); assert.equal(updates.length, 1);
});
test('WhatsApp content scripts cannot start campaigns and a pause cancels stale authorization', async () => {
  await assert.rejects(call('START', { config }, content), /somente no painel/);
  await open(); const jobId = state().job.id; await call('PAUSE');
  await assert.rejects(call('PREPARED', { jobId }, content), /cancelado/);
  assert.equal(state().queue[0].status, 'pending');
});
test('Chrome startup pauses in-flight work instead of sending unattended', async () => {
  await open(); events.startup(); await flush();
  assert.equal(state().status, 'paused'); assert.equal(state().job, null);
});
