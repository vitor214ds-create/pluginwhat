import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobRunner, createPageScheduler } from '../extension/content-main.js';
import { prepare, sendPrepared, unregisteredEvidence } from '../extension/whatsapp.js';
const { JSDOM } = await import(process.env.PLUGINWHAT_JSDOM || 'jsdom');

const phones = ['5511912345678', '5521912345678', '5531912345678', '5541912345678'];
const messages = ['Primeira mensagem\nOlá 🌱', 'Segunda mensagem', 'Terceira mensagem'];
const key = 'pluginwhatCampaign';
let generation = 0;

async function harness(t, { invalid = [], empty = [], noAck = false, dropReply = false, contactNames = {}, templateMessages = messages,
  modernEditor = false, semanticInfo = false, pointerRequired = false, editorUnavailable = false } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000000 });
  const dom = new JSDOM('<!doctype html><button aria-label="Nova conversa">Nova conversa</button><div id="pane-side"></div><section id="main"></section>', { url: 'https://web.whatsapp.com/' });
  const doc = dom.window.document, sent = [], alarms = new Map(), events = {}, storageListeners = new Set(), local = {}, session = {};
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { value() { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, set(text) { this.textContent = text; } });
  doc.execCommand = (command, _show, text) => {
    assert.equal(command, 'insertText'); const box = doc.activeElement; box.textContent = text;
    if (modernEditor || editorUnavailable) { box.textContent = ''; return false; }
    box.dispatchEvent(new dom.window.Event('input', { bubbles: true })); return true;
  };
  if (modernEditor) {
    dom.window.DataTransfer = class { data = {}; setData(type, value) { this.data[type] = value; } getData(type) { return this.data[type] || ''; } };
    dom.window.ClipboardEvent = class extends dom.window.Event { constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData; } };
  }
  const create = (tag, attrs = {}, text = '') => { const node = doc.createElement(tag); for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value); node.textContent = text; return node; };
  function chat(phone) {
    const main = doc.querySelector('#main'); main.replaceChildren();
    const label = contactNames[phone] || '+' + phone;
    const header = create('header'), title = create('span', { title: label, dir: 'auto' }, label), presence = create('span', {}, 'online');
    header.append(title, '\n', presence); main.append(header);
    title.addEventListener('click', () => {
      const drawer = create('aside', semanticInfo ? {} : { 'data-testid': 'drawer-right' });
      const heading = create('header'), close = create('button', { 'aria-label': 'Fechar' }, 'Fechar');
      heading.append(create('h2', {}, 'Dados do contato'), close); close.addEventListener('click', () => drawer.remove());
      drawer.append(heading, create('div', {}, 'Telefone: \u200e+' + phone)); doc.body.append(drawer);
    });
    const footer = create(modernEditor ? 'div' : 'footer', modernEditor ? { role: 'contentinfo' } : {}), box = create('div', { contenteditable: 'true', role: 'textbox', tabindex: '0', ...(modernEditor ? { 'data-lexical-editor': 'true' } : {}) });
    const button = create('button', { 'aria-label': modernEditor ? 'Enviar mensagem' : 'Enviar' }, 'Enviar'); footer.append(box, button); main.append(footer);
    let armed = false, registeredText = '';
    button.addEventListener('mousedown', () => { armed = true; });
    if (modernEditor) {
      button.setAttribute('aria-disabled', 'true');
      box.addEventListener('paste', event => {
        event.preventDefault(); if (editorUnavailable) return;
        registeredText = event.clipboardData.getData('text/plain'); box.textContent = registeredText; button.setAttribute('aria-disabled', 'false');
      });
    }
    button.addEventListener('click', () => {
      if (pointerRequired && !armed) return;
      const text = modernEditor ? registeredText : box.textContent;
      if (!text || button.getAttribute('aria-disabled') === 'true') return;
      armed = false;
      sent.push({ phone, text, at: Date.now() }); box.textContent = '';
      // Reproduce the reported failure: presence changes immediately after the click.
      presence.textContent = 'digitando…';
      const bubble = create('div', { class: 'message-out', 'data-id': `true_${phone}@c.us_M${sent.length}` });
      bubble.append(create('span', { class: 'selectable-text' }, text), create('span', { 'data-icon': 'msg-time' }));
      main.insertBefore(bubble, footer);
      if (!noAck) setTimeout(() => { bubble.querySelector('[data-icon]').setAttribute('data-icon', 'msg-check'); presence.textContent = 'visto por último hoje'; }, 300);
    });
  }
  doc.querySelector('[aria-label="Nova conversa"]').addEventListener('click', () => {
    doc.querySelector('[data-testid="drawer-left"]')?.remove();
    const drawer = create('aside', { 'data-testid': 'drawer-left' }), search = create('input', { 'aria-label': 'Pesquisar nome ou número' }), grid = create('div', { role: 'grid' });
    drawer.append(search, grid); doc.body.append(drawer);
    search.addEventListener('input', () => {
      const phone = search.value.replace(/\D/g, '');
      setTimeout(() => {
        grid.replaceChildren();
        if (invalid.includes(phone)) { grid.textContent = `O número +${phone} não está no WhatsApp.`; return; }
        if (empty.includes(phone)) { grid.textContent = 'Nenhum resultado encontrado. Verifique a conexão.'; return; }
        const row = create('div', { role: 'row' }, '+' + phone);
        row.addEventListener('click', () => { drawer.remove(); chat(phone); }); grid.append(row);
      }, 300);
    });
  });
  const event = name => ({ addListener(fn) { events[name] = fn; } });
  const contentSender = { id: 'fixture', url: 'https://web.whatsapp.com/', tab: { id: 10 }, frameId: 0, documentId: 'same-document' };
  const panelSender = { ...contentSender, url: 'chrome-extension://fixture/panel.html', frameId: 1 };
  let dropped = false, runner;
  const invoke = (request, sender) => new Promise((resolve, reject) => {
    try { events.message(request, sender, response => {
      if (dropReply && request.type === 'RESULT' && request.success && !dropped) { dropped = true; reject(new Error('Lost acknowledgement reply')); }
      else resolve(response);
    }); } catch (error) { reject(error); }
  });
  const area = object => ({
    async get(name) { return structuredClone({ [name]: object[name] }); },
    async set(value) {
      const changes = {}; for (const [name, data] of Object.entries(value)) { changes[name] = { oldValue: object[name], newValue: structuredClone(data) }; object[name] = structuredClone(data); }
      if (object === local) for (const listener of storageListeners) listener(changes, 'local');
    },
    async remove(names) { for (const name of names) delete object[name]; }
  });
  const chrome = {
    runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path, onMessage: event('message'), onStartup: event('startup'), sendMessage: request => invoke(request, contentSender) },
    storage: { local: area(local), session: area(session), onChanged: { addListener(fn) { storageListeners.add(fn); }, removeListener(fn) { storageListeners.delete(fn); } } },
    alarms: {
      async get(name) { return alarms.get(name); },
      async clear(name) { const old = alarms.get(name); if (old) clearTimeout(old.timer); alarms.delete(name); },
      async create(name, options) {
        await this.clear(name);
        const fire = () => {
          if (!options.periodInMinutes) alarms.delete(name);
          else alarms.get(name).timer = setTimeout(fire, options.periodInMinutes * 60000);
          events.alarm({ name });
        };
        alarms.set(name, { ...options, timer: setTimeout(fire, options.when != null ? Math.max(0, options.when - Date.now()) : options.periodInMinutes * 60000) });
      }, onAlarm: event('alarm')
    },
    tabs: {
      async get(id) { return { id, url: 'https://web.whatsapp.com/' }; },
      async sendMessage(_tab, request) {
        if (request.type === 'PING') return { ready: true };
        if (request.type === 'RUN_JOB') { const accepted = !runner.busy; if (accepted) void runner.run(request.jobId); return { accepted }; }
      },
      async update() { throw new Error('Navigation is forbidden'); }, async reload() { throw new Error('Reload is forbidden'); },
      onRemoved: event('removed'), onUpdated: event('updated')
    }, action: { onClicked: event('clicked') }
  };
  globalThis.chrome = chrome;
  let worker = await import(`../extension/background.js?generation=${generation++}`);
  await worker.exclusive(async () => {});
  runner = createJobRunner({ doc, api: chrome, host: {} });
  const scheduler = createPageScheduler({ doc, api: chrome }); await scheduler.start();
  async function advance(ms) {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      t.mock.timers.tick(Math.min(250, ms - elapsed));
      for (let flush = 0; flush < 30; flush++) await Promise.resolve();
    }
  }
  const start = async () => { const response = await invoke({ type: 'START', config: { contacts: phones, messages: templateMessages, intervalSeconds: 120 } }, panelSender); assert.equal(response.ok, true); await advance(2000); };
  const restartWorker = async () => { worker = await import(`../extension/background.js?generation=${generation++}`); await worker.exclusive(async () => {}); };
  t.after(() => { scheduler.stop(); dom.window.close(); t.mock.timers.reset(); });
  return { doc, sent, local, alarms, chrome, start, advance, restartWorker, state: () => local[key] };
}

test('one Start sends first, skips only confirmed nonexistent second, then sends third and fourth automatically with 120-second gaps', async t => {
  const f = await harness(t, { invalid: [phones[1]], dropReply: true }); await f.start();
  assert.equal(f.state().cursor, 1); assert.equal(f.state().status, 'running'); assert.equal(f.sent.length, 1);
  await f.advance(119000); assert.equal(f.sent.length, 1);
  await f.advance(5000); assert.equal(f.state().queue[1].status, 'invalid'); assert.equal(f.state().cursor, 2);
  await f.advance(122000); assert.equal(f.sent.length, 2); assert.equal(f.state().cursor, 3);
  await f.advance(122000); assert.equal(f.state().status, 'completed'); assert.equal(f.sent.length, 3);
  assert.deepEqual(f.sent.map(row => [row.phone, row.text]), [[phones[0], messages[0]], [phones[2], messages[2]], [phones[3], messages[0]]]);
  assert.deepEqual(f.state().queue.map(row => row.status), ['sent', 'invalid', 'sent', 'sent']);
  assert.ok(f.sent[1].at - f.sent[0].at >= 240000); assert.ok(f.sent[2].at - f.sent[1].at >= 120000);
});
test('worker suspension and a lost one-shot alarm do not strand the next valid contact', async t => {
  const f = await harness(t); await f.start(); const due = f.state().nextAt;
  await f.chrome.alarms.clear('pluginwhat-next'); await f.restartWorker();
  await f.advance(123000); assert.equal(f.sent.length, 2); assert.ok(f.sent[1].at >= due); assert.equal(f.state().cursor, 2);
});
test('empty search and connectivity errors never skip a contact or mark it as sent', async t => {
  const f = await harness(t, { empty: [phones[0]] }); await f.start(); await f.advance(80000);
  assert.equal(f.state().status, 'paused'); assert.equal(f.state().cursor, 0); assert.equal(f.state().queue[0].status, 'pending');
  assert.equal(f.state().queue[0].attempts, 3); assert.equal(f.sent.length, 0);
});
test('a message still showing a clock is not marked sent, retried or skipped', async t => {
  const f = await harness(t, { noAck: true }); await f.start(); await f.advance(65000);
  assert.equal(f.sent.length, 1); assert.equal(f.state().cursor, 0); assert.equal(f.state().queue[0].status, 'uncertain'); assert.equal(f.state().status, 'paused');
});
test('a nonexistent first number is skipped automatically and the first valid contact receives its own variant after the interval', async t => {
  const f = await harness(t, { invalid: [phones[0]] }); await f.start();
  assert.equal(f.sent.length, 0); assert.equal(f.state().cursor, 1); assert.equal(f.state().queue[0].status, 'invalid');
  await f.advance(122000); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].phone, phones[1]); assert.equal(f.sent[0].text, messages[1]);
});
test('an unrelated invalid-number alert, empty results and invite buttons do not establish that this recipient is nonexistent', async t => {
  const f = await harness(t);
  const scope = f.doc.createElement('aside'); f.doc.body.append(scope);
  for (const text of ['Nenhum resultado', 'Convidar para o WhatsApp', `+${phones[1]} não está no WhatsApp.`, 'Não foi possível conectar']) {
    scope.textContent = text; assert.equal(unregisteredEvidence(f.doc, { phone: phones[0] }, scope), null);
  }
  scope.textContent = `+${phones[0]} não está no WhatsApp.`;
  assert.ok(unregisteredEvidence(f.doc, { phone: phones[0] }, scope));
});
test('an old matching message re-rendered under the same ID cannot confirm a new clock-only message', async t => {
  const f = await harness(t); await f.start();
  const main = f.doc.querySelector('#main'), box = main.querySelector('[contenteditable]'), button = main.querySelector('footer button');
  box.textContent = messages[0];
  const snapshot = await prepare({ phone: phones[0], message: messages[0] }, { doc: f.doc, timeout: 1 });
  const old = main.querySelector('.message-out');
  // Replace the send button to simulate old-bubble virtualization and a pending new send.
  const replacement = button.cloneNode(true); button.replaceWith(replacement);
  replacement.addEventListener('click', () => {
    const rerendered = old.cloneNode(true); old.replaceWith(rerendered);
    const pending = rerendered.cloneNode(true); pending.setAttribute('data-id', 'true_phone_NEW'); pending.querySelector('[data-icon]').setAttribute('data-icon', 'msg-time'); main.insertBefore(pending, main.querySelector('footer')); box.textContent = '';
  });
  const operation = sendPrepared({ phone: phones[0], message: messages[0] }, snapshot, { doc: f.doc, timeout: 500 });
  const rejected = assert.rejects(operation, /verificar/); await f.advance(1000); await rejected;
});
test('modern controlled editor, semantic contact info and pointer-based send process personalized and unnamed contacts automatically', async t => {
  const f = await harness(t, { modernEditor: true, semanticInfo: true, pointerRequired: true,
    contactNames: { [phones[0]]: 'Maria da Silva', [phones[2]]: 'João 🌱', [phones[3]]: 'Ana $&' },
    templateMessages: ['Bom dia (nome), tudo bem?', 'Olá (NOME)!', 'Boa tarde, ( nome ).'] });
  await f.start(); await f.advance(370000);
  assert.equal(f.state().status, 'completed'); assert.equal(f.sent.length, 4);
  assert.deepEqual(f.sent.map(row => row.text), ['Bom dia Maria da Silva, tudo bem?', 'Olá!', 'Boa tarde, João 🌱.', 'Bom dia Ana $&, tudo bem?']);
  assert.deepEqual(f.state().queue.map(row => row.contactName), ['Maria da Silva', '', 'João 🌱', 'Ana $&']);
  assert.ok(f.sent.slice(1).every((row, i) => row.at - f.sent[i].at >= 120000));
});
test('an unavailable editor produces a precise filling error and never pretends the empty message was sent', async t => {
  const f = await harness(t, { modernEditor: true, editorUnavailable: true }); await f.start(); await f.advance(20000);
  assert.equal(f.sent.length, 0); assert.equal(f.state().status, 'paused'); assert.equal(f.state().cursor, 0);
  assert.equal(f.state().queue[0].errorCode, 'EDITOR_INSERT_FAILED'); assert.equal(f.state().queue[0].lastStage, 'filling');
});
