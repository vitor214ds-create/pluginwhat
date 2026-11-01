import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, sendPrepared } from '../whatsapp.js';

// Minimal DOM fixture: no network, live session, or real recipient is used.
const job = { phone: '5511912345678', message: 'Olá!\nTudo bem? 🌱' };
function element(properties = {}) {
  return { isConnected: true, innerText: '', getClientRects: () => [{}], querySelector: () => null,
    querySelectorAll: () => [], ...properties };
}
function fixture({ phone = job.phone, draft = job.message, ack = true, old = false } = {}) {
  let clicks = 0;
  const bubbles = [];
  function bubble(confirmed) {
    const text = element({ innerText: job.message });
    return element({ querySelectorAll: () => [text], querySelector: () => confirmed ? element() : null });
  }
  if (old) bubbles.push(bubble(true));
  const box = element({ innerText: draft });
  const button = element({ click() { clicks++; box.innerText = ''; bubbles.push(bubble(ack)); } });
  const header = element({ innerText: `+${phone}\nonline` });
  const main = element({
    querySelector: selector => selector === 'header' ? header : null,
    querySelectorAll: selector => selector === '.message-out' ? bubbles : []
  });
  const doc = { querySelector(selector) {
    if (selector.startsWith('#pane-side')) return element();
    if (selector === '#main') return main;
    if (selector.includes('[contenteditable=')) return box;
    if (selector.includes('[data-icon="send"]')) return { closest: () => button };
    return null;
  } };
  return { doc, main, header, box, button, clicks: () => clicks };
}

test('verified number + matching draft + a new acknowledged outgoing bubble yields one click', async () => {
  const f = fixture();
  const snapshot = await prepare(job, { doc: f.doc, timeout: 1 });
  await sendPrepared(job, snapshot, { doc: f.doc, timeout: 1 });
  assert.equal(f.clicks(), 1);
});
test('a different phone never receives a message when its identity cannot be verified', async () => {
  const f = fixture({ phone: '5521912345678' });
  await assert.rejects(prepare(job, { doc: f.doc, timeout: 1 }), /dados do contato/);
  assert.equal(f.clicks(), 0);
});
test('a changed draft or user interaction aborts before the click', async () => {
  const f = fixture(); const snapshot = await prepare(job, { doc: f.doc, timeout: 1 });
  f.box.innerText = 'outra mensagem';
  await assert.rejects(sendPrepared(job, snapshot, { doc: f.doc, timeout: 1 }), /conversa mudou/);
  assert.equal(f.clicks(), 0);
  await assert.rejects(prepare(job, { doc: f.doc, cancelled: () => true, timeout: 1 }), /alterada/);
});
test('an old identical acknowledged message cannot confirm a new message still showing a clock', async () => {
  const f = fixture({ ack: false, old: true }); const snapshot = await prepare(job, { doc: f.doc, timeout: 1 });
  await assert.rejects(sendPrepared(job, snapshot, { doc: f.doc, timeout: 1 }), /verificar/);
  assert.equal(f.clicks(), 1);
});
test('a detached conversation snapshot cannot send into the new active conversation', async () => {
  const f = fixture(); const snapshot = await prepare(job, { doc: f.doc, timeout: 1 });
  f.main.isConnected = false;
  await assert.rejects(sendPrepared(job, snapshot, { doc: f.doc, timeout: 1 }), /conversa mudou/);
  assert.equal(f.clicks(), 0);
});
test('saved contacts are checked against the contact info drawer, not their display name', async () => {
  const f = fixture(); f.header.innerText = 'Cliente';
  let opened = false, closed = false;
  f.header.querySelector = () => ({ click() { opened = true; } });
  const drawer = element({ innerText: 'Dados do contato\nCliente\n+55 11 91234-5678',
    querySelector: () => ({ click() { closed = true; } }) });
  const query = f.doc.querySelector.bind(f.doc);
  f.doc.querySelector = selector => selector.startsWith('[data-testid="drawer-right"]') && opened ? drawer : query(selector);
  const snapshot = await prepare(job, { doc: f.doc, timeout: 1 });
  assert.equal(closed, true);
  await sendPrepared(job, snapshot, { doc: f.doc, timeout: 1 });
  assert.equal(f.clicks(), 1);
});
