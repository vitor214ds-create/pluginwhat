import test from 'node:test';
import assert from 'node:assert/strict';
import { openConversation, prepare, sendPrepared } from '../whatsapp.js';

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

test('opening a contact uses the native search and changes only the selected conversation', async () => {
  const f = fixture(); const scope = { querySelectorAll: () => [row] };
  let newChatClicks = 0, rowClicks = 0;
  const search = element({ value: '', focus() {}, matches: () => true, dispatchEvent() {},
    getAttribute: name => name === 'aria-label' ? 'Pesquisar nome ou número' : null,
    closest: selector => selector.includes('drawer-left') ? scope : null });
  const row = element({ innerText: '+55 11 91234-5678', closest: () => null, contains: () => false,
    click() { rowClicks++; row.isConnected = false; } });
  const button = element({ click() { newChatClicks++; } });
  const originalQuery = f.doc.querySelector.bind(f.doc);
  f.doc.querySelector = selector => selector.startsWith('[aria-label="Nova conversa"]') ? button : originalQuery(selector);
  f.doc.querySelectorAll = () => [search];
  f.doc.defaultView = { Event };
  await openConversation(job, { doc: f.doc, timeout: 1 });
  assert.equal(newChatClicks, 1); assert.equal(search.value, '+' + job.phone); assert.equal(rowClicks, 1);
  assert.equal(f.clicks(), 0);
});

function enableEditing(f) {
  let edits = 0;
  f.box.focus = () => {}; f.box.matches = () => false;
  f.doc.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  f.doc.createRange = () => ({ selectNodeContents() {} });
  f.doc.execCommand = (command, _unused, text) => { assert.equal(command, 'insertText'); edits++; f.box.innerText = text; return true; };
  return () => edits;
}
test('the message is inserted into the current editor only after the phone is verified', async () => {
  const f = fixture({ draft: '' }); const edits = enableEditing(f);
  const snapshot = await prepare(job, { doc: f.doc, timeout: 1, fillMessage: true });
  assert.equal(edits(), 1); assert.equal(f.box.innerText, job.message);
  await sendPrepared(job, snapshot, { doc: f.doc, timeout: 1 }); assert.equal(f.clicks(), 1);
});
test('a different phone cannot have its draft changed by the new in-page opening flow', async () => {
  const f = fixture({ phone: '5521912345678', draft: '' }); const edits = enableEditing(f);
  await assert.rejects(prepare(job, { doc: f.doc, timeout: 1, fillMessage: true }), /dados do contato/);
  assert.equal(edits(), 0); assert.equal(f.clicks(), 0);
});
test('opening in-page preserves an existing unrelated draft instead of overwriting it', async () => {
  const f = fixture({ draft: 'Meu rascunho' }); const edits = enableEditing(f);
  await assert.rejects(prepare(job, { doc: f.doc, timeout: 1, fillMessage: true }), /rascunho diferente/);
  assert.equal(edits(), 0); assert.equal(f.box.innerText, 'Meu rascunho'); assert.equal(f.clicks(), 0);
});
