import assert from 'node:assert/strict';
import { createPageScheduler } from '../extension/content-main.js';

// A real two-minute timer, separate from the simulated-clock integration suite.
// No WhatsApp account, tab navigation or message send is involved.
const started = Date.now(), due = started + 120000;
let resolve, reject, scheduler;
const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
const guard = setTimeout(() => reject(new Error('Scheduler did not wake within 125 seconds')), 125000);
const doc = { addEventListener() {}, removeEventListener() {} };
const api = {
  storage: { local: { async get() { return { pluginwhatCampaign: { status: 'running', job: null, nextAt: due } }; } }, onChanged: { addListener() {}, removeListener() {} } },
  runtime: { async sendMessage(request) {
    assert.equal(request.type, 'TICK'); assert.ok(Date.now() >= due);
    console.log(`Real-time scheduler woke automatically after ${Date.now() - started} ms.`);
    scheduler.stop(); clearTimeout(guard); resolve(); return { ok: true };
  } }
};
scheduler = createPageScheduler({ doc, api });
console.log('Checking the actual 120-second automatic wake-up…');
await scheduler.start(); await finished;
