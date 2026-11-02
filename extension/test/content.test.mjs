import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobRunner } from '../content-main.js';

function fixture(actions = {}) {
  const listeners = new Map(), storageListeners = new Set(), calls = [], steps = [];
  const doc = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); }
  };
  const api = {
    storage: { onChanged: { addListener(fn) { storageListeners.add(fn); }, removeListener(fn) { storageListeners.delete(fn); } } },
    runtime: { async sendMessage(request) {
      calls.push(request);
      if (request.type === 'CONTENT_READY') return { ok: true, job: { id: request.jobId, phone: '5511912345678', message: request.jobId } };
      if (request.type === 'PREPARED') return { ok: true, approved: true };
      return { ok: true, accepted: true };
    } }
  };
  const runner = createJobRunner({ doc, api, host: {}, actions: {
    async openConversation(job, options) { assert.equal(options.doc, doc); steps.push(['open', job.id]); },
    async prepare(job, options) { assert.equal(options.fillMessage, true); steps.push(['prepare', job.id]); return {}; },
    async sendPrepared(job, _snapshot, options) { options.onClick(); steps.push(['send', job.id]); return { confirmed: true }; }, ...actions
  } });
  return { runner, listeners, storageListeners, calls, steps };
}

test('the same loaded document processes successive contacts without page startup or navigation', async () => {
  const f = fixture();
  await f.runner.run('first'); await f.runner.run('second');
  assert.deepEqual(f.steps, [['open', 'first'], ['prepare', 'first'], ['send', 'first'], ['open', 'second'], ['prepare', 'second'], ['send', 'second']]);
  assert.equal(f.calls.filter(r => r.type === 'RESULT' && r.success).length, 2);
  assert.equal(f.runner.busy, false); assert.equal(f.listeners.size, 0); assert.equal(f.storageListeners.size, 0);
});
test('duplicate delivery cannot send a second message while the same document is busy', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ async openConversation() { await gate; } });
  const first = f.runner.run('first');
  assert.equal(f.runner.busy, true);
  await f.runner.run('duplicate'); release(); await first;
  assert.equal(f.calls.filter(r => r.type === 'CONTENT_READY').length, 1);
  assert.equal(f.calls.filter(r => r.type === 'RESULT' && r.success).length, 1);
});
test('pausing while opening a contact cancels its pending send in the existing page', async () => {
  let f;
  f = fixture({ async openConversation(_job, options) {
    for (const fn of f.storageListeners) fn({ pluginwhatCampaign: { newValue: { status: 'paused', job: null } } }, 'local');
    assert.equal(options.cancelled(), true);
    throw new Error('Pausado');
  } });
  await f.runner.run('first');
  assert.equal(f.steps.some(([step]) => step === 'send'), false);
  assert.equal(f.calls.at(-1).preparing, true); assert.equal(f.calls.at(-1).success, false);
  assert.equal(f.runner.busy, false);
});
