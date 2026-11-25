import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_KEY } from '../core.js';

const events = {};
function event(name) { return { addListener(fn) { events[name] = fn; } }; }
const local = {}, session = {}, alarms = new Map(), runs = [];
const storage = object => ({
  async get(key) { return structuredClone({ [key]: object[key] }); },
  async set(value) { Object.assign(object, structuredClone(value)); },
  async remove(keys) { for (const key of keys) delete object[key]; }
});
globalThis.chrome = {
  runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, getManifest: () => ({version:'1.3.1'}), onMessageExternal: event('external'), onMessage: event('message'), onStartup: event('startup') },
  storage: { local: storage(local), session: storage(session) },
  alarms: { async get(name) { return alarms.get(name); }, async clear(name) { alarms.delete(name); }, async create(name, options) { alarms.set(name, options); }, onAlarm: event('alarm') },
  tabs: { async query() { return [{id:7,active:true,url:'https://web.whatsapp.com/'}]; }, async get(id) { if (!Number.isInteger(id)) throw new Error('closed'); return { id, url: 'https://web.whatsapp.com/' }; },
    async update() { throw new Error('Unexpected tab navigation'); },
    async sendMessage(id, request, options) {
      if (request.type === 'RUN_JOB') { runs.push({ id, ...request, options }); return { accepted: true }; }
      return { ready: true };
    },
    onRemoved: event('removed'), onUpdated: event('updated'), async create() {}, async reload() { throw new Error('Unexpected page reload'); } },
  action: { onClicked: event('clicked') }
};
const { handle, handleExternal, exclusive } = await import('../background.js');
await exclusive(async () => {});
const panel = { id: 'test', url: 'chrome-extension://test/panel.html', tab: { id: 7 }, frameId: 1 };
const content = { id: 'test', url: 'https://web.whatsapp.com/', tab: { id: 7 }, frameId: 0, documentId: 'doc-A' };
const config = { contacts: ['5511912345678', '5521912345678'], messages: ['a', 'b', 'c'], intervalSeconds: 90 };
const call = (type, extra = {}, sender = panel) => exclusive(() => handle({ type, ...extra }, sender));
const flush = () => exclusive(async () => {});
const state = () => local[STATE_KEY];
async function open() {
  delete local[STATE_KEY]; runs.length = 0;
  await call('START', { config });
  // The public listener dispatches a start after replying; simulate its alarm here.
  events.alarm({ name: 'pluginwhat-next' }); await flush();
  return call('CONTENT_READY', { jobId: runs[0].jobId }, content);
}

test('only the bound tab, job token and current document may authorize a click', async () => {
  await open();
  const jobId = state().job.id;
  await assert.rejects(call('PREPARED', { jobId }, { ...content, tab: { id: 8 } }), /cancelado/);
  await assert.rejects(call('PREPARED', { jobId }, { ...content, documentId: 'stale' }), /cancelado/);
  await assert.rejects(call('PREPARED', { jobId }, { ...content, frameId: 1 }), /cancelado/);
  await call('PREPARED', { jobId }, content);
  await assert.rejects(call('PREPARED', { jobId }, content), /cancelado/);
  assert.equal(state().job.phase, 'sending'); assert.equal(runs.length, 1);
});
test('dispatch sends a frame-zero job instead of updating or reloading the tab', async () => {
  await open();
  assert.equal(runs.length, 1); assert.equal(runs[0].type, 'RUN_JOB');
  assert.equal(runs[0].id, 7); assert.deepEqual(runs[0].options, { frameId: 0 });
  assert.equal(state().job.phase, 'preparing');
  assert.deepEqual(await call('CONTENT_READY', { jobId: 'stale' }, content), { job: null });
});
test('two simultaneous START commands cannot create overlapping campaigns', async () => {
  delete local[STATE_KEY];
  const results = await Promise.allSettled([call('START', { config }), call('START', { config })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
test('a successful ack advances once and the alarm does not open another conversation before the interval', async () => {
  await open(); const jobId = state().job.id;
  local[STATE_KEY].queue[0].errorCode = 'PREVIOUS_ERROR';
  await call('PREPARED', { jobId }, content);
  const now = Date.now(); await call('RESULT', { jobId, success: true, evidence: { confirmed: true } }, content);
  assert.equal(state().cursor, 1); assert.equal(state().queue[0].status, 'sent');
  assert.equal(state().queue[0].errorCode, '');
  assert.ok(state().nextAt >= now + 90000);
  events.alarm({ name: 'pluginwhat-next' }); await flush();
  assert.equal(runs.length, 1);
  assert.deepEqual(await call('RESULT', { jobId, success: true, evidence: { confirmed: true } }, content), { accepted: true });
  assert.equal(state().cursor, 1);
});
test('closing a tab during a click records uncertainty and blocks resume', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  events.removed(7); await flush();
  assert.equal(state().status, 'paused'); assert.equal(state().queue[0].status, 'uncertain');
  await assert.rejects(call('RESUME'), /Confira/);
  await assert.rejects(call('RESOLVE', { resolution: 'skipped' }));
  await call('RESOLVE', { resolution: 'retry' });
  assert.equal(state().cursor, 0); assert.equal(state().queue[0].status, 'pending');
});
test('timeout after click pauses instead of retrying a potentially sent message', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  local[STATE_KEY].job.deadline = 0;
  events.alarm({ name: 'pluginwhat-next' }); await flush();
  assert.equal(state().status, 'paused'); assert.equal(state().queue[0].status, 'uncertain'); assert.equal(runs.length, 1);
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

test('confirmed unregistered phone advances automatically and schedules the full interval', async () => {
  await open(); const jobId = state().job.id, before = Date.now();
  await call('RESULT', { jobId, preparing: true, clicked: false, errorCode: 'UNREGISTERED', unregisteredConfirmed: true, error: 'Não cadastrado.' }, content);
  assert.equal(state().cursor, 1); assert.equal(state().queue[0].status, 'invalid'); assert.equal(state().status, 'running');
  assert.ok(state().nextAt >= before + 90000); assert.ok(alarms.has('pluginwhat-watchdog'));
});
test('generic lookup failure stays on the same contact and retries without skipping', async () => {
  await open(); const jobId = state().job.id;
  await call('RESULT', { jobId, preparing: true, clicked: false, retryable: true, error: 'Sem conexão.' }, content);
  assert.equal(state().cursor, 0); assert.equal(state().queue[0].status, 'pending'); assert.equal(state().status, 'running'); assert.equal(state().job, null);
});
test('a failure before the actual click does not mark a valid first contact sent or uncertain', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  await call('RESULT', { jobId, preparing: false, clicked: false, retryable: true, error: 'Editor mudou.' }, content);
  assert.equal(state().queue[0].status, 'pending'); assert.equal(state().cursor, 0); assert.equal(state().status, 'running');
});
test('a claimed success without outgoing acknowledgement cannot advance the queue', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  await call('RESULT', { jobId, success: true, clicked: true }, content);
  assert.equal(state().cursor, 0); assert.equal(state().queue[0].status, 'uncertain');
});

test('the authorized send uses the resolved name and rejects a message different from the configured template', async () => {
  await open(); let jobId = state().job.id;
  local[STATE_KEY].job.message = 'Bom dia (nome), tudo bem?';
  await assert.rejects(call('PREPARED', { jobId, contactName: 'Maria', message: 'Outro texto' }, content), /não corresponde/);
  await call('PREPARED', { jobId, contactName: 'Maria', message: 'Bom dia Maria, tudo bem?' }, content);
  assert.equal(state().job.message, 'Bom dia Maria, tudo bem?'); assert.equal(state().queue[0].contactName, 'Maria');
});
test('reviewing an interrupted send from another WhatsApp tab rebinds the resumed campaign to that tab', async () => {
  await open(); const jobId = state().job.id; await call('PREPARED', { jobId }, content);
  events.removed(7); await flush();
  const replacementPanel = { ...panel, tab: { id: 8 } };
  await call('RESOLVE', { resolution: 'retry' }, replacementPanel);
  assert.equal(state().tabId, 8); assert.equal(state().status, 'running'); assert.equal(state().cursor, 0);
});

const externalSender = { url: 'https://site-scout-ai-90.lovable.app/search', origin: 'https://site-scout-ai-90.lovable.app', frameId: 0 };
const clientId = '11111111-1111-4111-a111-111111111111';
const siteCall = (type, extra = {}, sender = externalSender) => exclusive(() => handleExternal({ protocol: 'sitehunter-pluginwhat-v1', clientId, type, ...extra }, sender));
function siteCampaign() {
  return { requestId: crypto.randomUUID(), messages: ['Olá (empresa): (previa)', 'Bom dia (empresa)', 'Visite (previa)'], intervalSeconds: 120,
    recipients: config.contacts.map((phone,index) => ({ phone, name:'Empresa '+index, city:'Vitória', placeId:'place-'+index,
      previewUrl:'https://site-scout-ai-90.lovable.app/p/'+String(index+1).repeat(64), expiresAt:new Date(Date.now()+86400000).toISOString() })) };
}
test('site starts an idempotent campaign with each recipients own preview and dispatches without navigation', async () => {
  delete local[STATE_KEY]; runs.length=0;
  const campaign=siteCampaign(); const start=await siteCall('START_CAMPAIGN',{campaign});
  assert.equal(start.dispatch,true); assert.equal(start.state.queue.length,2);
  const duplicate=await siteCall('START_CAMPAIGN',{campaign});
  assert.equal(duplicate.state.id,start.state.id); assert.equal(duplicate.dispatch,undefined);
  events.alarm({name:'pluginwhat-next'});await flush();
  const ready=await call('CONTENT_READY',{jobId:runs[0].jobId},content);
  assert.ok(ready.job.message.includes(campaign.recipients[0].previewUrl));
  assert.ok(!ready.job.message.includes(campaign.recipients[1].previewUrl));
  await call('PREPARED',{jobId:ready.job.id,message:ready.job.message},content);
  const before=Date.now(); await call('RESULT',{jobId:ready.job.id,success:true,evidence:{confirmed:true}},content);
  assert.ok(state().nextAt>=before+120000);
  local[STATE_KEY].nextAt=0;
  events.alarm({name:'pluginwhat-next'});await flush();
  const second=await call('CONTENT_READY',{jobId:runs[1].jobId},content);
  assert.ok(second.job.message.startsWith('Bom dia Empresa 1'));
  assert.ok(second.job.message.endsWith(campaign.recipients[1].previewUrl));
  assert.ok(!second.job.message.includes(campaign.recipients[0].previewUrl));
});
test('untrusted origins cannot start or inspect; other local clients cannot see or control this queue', async () => {
  const current=state();
  await assert.rejects(siteCall('GET_STATUS',{}, {...externalSender,url:'https://attacker.test/search',origin:'https://attacker.test'}),/Origem/);
  const other=await exclusive(()=>handleExternal({protocol:'sitehunter-pluginwhat-v1',clientId:crypto.randomUUID(),type:'GET_STATUS'},externalSender));
  assert.equal(other.state,null); assert.equal(other.busy,true);
  await assert.rejects(exclusive(()=>handleExternal({protocol:'sitehunter-pluginwhat-v1',clientId:crypto.randomUUID(),type:'STOP_CAMPAIGN',campaignId:current.id},externalSender)),/pertence/);
  assert.equal(state().status,'running');
});
test('site pause and resume preserve the remaining interval and expired previews keep the recipient pending', async () => {
  delete local[STATE_KEY];runs.length=0;
  const campaign=siteCampaign();await siteCall('START_CAMPAIGN',{campaign});
  local[STATE_KEY].nextAt=Date.now()+120000;local[STATE_KEY].notBefore=local[STATE_KEY].nextAt;
  const due=state().nextAt;
  await siteCall('PAUSE_CAMPAIGN',{campaignId:state().id});
  await siteCall('RESUME_CAMPAIGN',{campaignId:state().id});
  assert.ok(state().nextAt>=due);
  local[STATE_KEY].queue[0].expiresAt='2000-01-01';local[STATE_KEY].nextAt=0;
  events.alarm({name:'pluginwhat-next'});await flush();
  assert.equal(runs.length,0);assert.equal(state().status,'paused');assert.equal(state().cursor,0);assert.equal(state().queue[0].status,'pending');
});

test('an old request cannot create a duplicate after another campaign has replaced the current state', async () => {
  delete local[STATE_KEY]; const first=siteCampaign();await siteCall('START_CAMPAIGN',{campaign:first});
  await siteCall('STOP_CAMPAIGN',{campaignId:state().id});
  const second=siteCampaign();await siteCall('START_CAMPAIGN',{campaign:second});
  await siteCall('STOP_CAMPAIGN',{campaignId:state().id});const retained=state().id;
  const replay=await siteCall('START_CAMPAIGN',{campaign:first});
  assert.equal(replay.alreadyStarted,true);assert.equal(replay.state,null);assert.equal(state().id,retained);assert.equal(state().status,'stopped');
});
