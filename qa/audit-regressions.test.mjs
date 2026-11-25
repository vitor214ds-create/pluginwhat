import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readText, normalizeText, unregisteredEvidence, composer, prepare, sendPrepared, isLoggedIn } from '../extension/whatsapp.js';

function documentFor(html) {
  const dom = new JSDOM(html);
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { value() { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  return dom;
}

test('emoji rendered as an image preserves a following block line and intentional blank line', () => {
  const dom = documentFor('<div id="text">Bom dia <img alt="🌱"><div>Tudo bem?</div><div><br></div><div>Até logo.</div></div>');
  assert.equal(normalizeText(readText(dom.window.document.querySelector('#text'))), 'Bom dia 🌱\nTudo bem?\n\nAté logo.');
  dom.window.close();
});
test('a contact profile description is not evidence that its valid number is unregistered', () => {
  const dom = documentFor('<aside><input aria-label="Pesquisar nome ou número"><div role="row">Maria<br>+5511912345678<br>Este número não está no WhatsApp.</div></aside>');
  assert.equal(unregisteredEvidence(dom.window.document, { phone: '5511912345678' }, dom.window.document.querySelector('aside')), null);
  dom.window.close();
});
test('the compose field can use the native plaintext-only contenteditable mode', () => {
  const dom = documentFor('<section id="main"><div contenteditable="plaintext-only" role="textbox" aria-label="Digite uma mensagem"></div></section>');
  assert.equal(composer(dom.window.document), dom.window.document.querySelector('[contenteditable]'));
  dom.window.close();
});
test('a hidden cached chat list does not count as a ready logged-in session', () => {
  const dom = documentFor('<div id="pane-side" hidden></div>');
  assert.equal(isLoggedIn(dom.window.document), false); dom.window.close();
});
test('a group named after a phone number cannot be mistaken for a direct recipient', async () => {
  const phone = '5511912345678';
  const dom = documentFor(`<div id="pane-side"></div><section id="main"><header><span title="+${phone}">+${phone}</span><button aria-label="Dados do grupo">Dados do grupo</button></header><div class="message-in" data-id="false_120363123456789@g.us_OLD"></div><footer><div contenteditable="true" role="textbox">Olá</div><button aria-label="Enviar">Enviar</button></footer></section>`);
  await assert.rejects(prepare({ phone, message: 'Olá' }, { doc: dom.window.document, timeout: 1 }), /grupo/i);
  dom.window.close();
});
test('switching to another chat with the same title is detected through the conversation ID', async () => {
  const phone = '5511912345678';
  const dom = documentFor(`<div id="pane-side"></div><section id="main"><header><span title="+${phone}">+${phone}</span></header><div class="message-in" data-id="false_${phone}@c.us_OLD"></div><footer><div contenteditable="true" role="textbox">Olá</div><button aria-label="Enviar">Enviar</button></footer></section>`);
  const doc = dom.window.document;
  const snapshot = await prepare({ phone, message: 'Olá' }, { doc, timeout: 1 });
  doc.querySelector('[data-id]').setAttribute('data-id', 'false_5521912345678@c.us_OTHER');
  let clicked = false; doc.querySelector('button').addEventListener('click', () => { clicked = true; });
  await assert.rejects(sendPrepared({ phone, message: 'Olá' }, snapshot, { doc, timeout: 1 }), /conversa mudou/i);
  assert.equal(clicked, false); dom.window.close();
});
test('an unavailable synthetic-paste constructor falls back to browser text insertion', async () => {
  const phone = '5511912345678';
  const dom = documentFor(`<div id="pane-side"></div><section id="main"><header><span title="+${phone}">+${phone}</span></header><footer><div contenteditable="true" role="textbox" tabindex="0"></div><button aria-label="Enviar">Enviar</button></footer></section>`);
  const doc = dom.window.document;
  dom.window.DataTransfer = class { constructor() { throw new Error('Unsupported constructor'); } };
  dom.window.ClipboardEvent = class extends dom.window.Event {};
  doc.execCommand = (_command, _unused, text) => { doc.activeElement.textContent = text; return true; };
  const snapshot = await prepare({ phone, message: 'Olá, tudo bem?' }, { doc, fillMessage: true, timeout: 1 });
  assert.equal(snapshot.message, 'Olá, tudo bem?'); assert.equal(doc.querySelector('[contenteditable]').textContent, snapshot.message);
  dom.window.close();
});
test('unmapped identifier namespaces alone do not cause a false conversation-change error', async () => {
  const phone = '5511912345678';
  const dom = documentFor(`<div id="pane-side"></div><section id="main"><header><span title="+${phone}">+${phone}</span></header><div class="message-in" data-id="false_${phone}@c.us_OLD"></div><footer><div contenteditable="true" role="textbox">Olá</div><button aria-label="Enviar">Enviar</button></footer></section>`);
  const doc = dom.window.document;
  const snapshot = await prepare({ phone, message: 'Olá' }, { doc, timeout: 1 });
  doc.querySelector('[data-id]').setAttribute('data-id', 'false_123456789012345@lid_OLD');
  doc.querySelector('button').addEventListener('click', () => {
    doc.querySelector('[contenteditable]').textContent = '';
    const bubble = doc.createElement('div'); bubble.className = 'message-out'; bubble.dataset.id = 'true_123456789012345@lid_NEW';
    bubble.innerHTML = '<span class="selectable-text">Olá</span><span data-icon="msg-check"></span>'; doc.querySelector('#main').append(bubble);
  });
  const result = await sendPrepared({ phone, message: 'Olá' }, snapshot, { doc, timeout: 1 });
  assert.equal(result.confirmed, true); dom.window.close();
});
