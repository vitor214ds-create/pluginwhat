// DOM adapter only: no private WhatsApp APIs, remote scripts or session access.
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function normalizeText(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim(); }
export function isLoggedIn(doc = document) { return Boolean(doc.querySelector('#pane-side, [data-testid="chat-list"]')); }
export function composer(doc = document) {
  return doc.querySelector('#main footer [contenteditable="true"][role="textbox"]');
}
function visible(element) { return Boolean(element && element.isConnected && element.getClientRects().length); }
function phoneIn(text, phone) {
  // Match a complete phone-looking field, never a substring or a group participant.
  return String(text || '').split(/\n/).some(line =>
    /^\+?[\d\s().-]+$/.test(line.trim()) && line.replace(/\D/g, '') === phone);
}
function infoDrawer(doc) {
  return doc.querySelector('[data-testid="drawer-right"], [data-testid="contact-info-drawer"], [role="dialog"][aria-label="Contact info"], [role="region"][aria-label="Dados do contato"]');
}
export function sendButton(doc = document) {
  const icon = doc.querySelector('#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"]');
  return icon?.closest('button, [role="button"]') || doc.querySelector('#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"], #main footer [role="button"][aria-label="Enviar"], #main footer [role="button"][aria-label="Send"]');
}
function checkCancelled(cancelled) { if (cancelled()) throw new Error('A conversa foi alterada durante a preparação. Sequência pausada.'); }
async function until(check, timeout, cancelled) {
  const deadline = Date.now() + timeout;
  do {
    checkCancelled(cancelled);
    const value = check(); if (value) return value;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error('Não foi possível verificar a conversa. Confira o número, sua conexão e a sessão do WhatsApp.');
}

function replaceEditable(box, text, doc) {
  box.focus();
  if (box.matches('input, textarea')) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')?.set;
    if (setter) setter.call(box, text); else box.value = text;
    box.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    box.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  } else {
    // Use Chrome's editing pipeline so WhatsApp's editor receives its native input event.
    const selection = doc.getSelection();
    const range = doc.createRange(); range.selectNodeContents(box);
    selection.removeAllRanges(); selection.addRange(range);
    doc.execCommand('insertText', false, text);
    selection.removeAllRanges();
  }
}
function newChatButton(doc) {
  const button = doc.querySelector('[aria-label="Nova conversa"], [title="Nova conversa"], [aria-label="New chat"], [title="New chat"]');
  if (visible(button)) return button;
  return doc.querySelector('[data-icon="new-chat-outline"], [data-icon="new-chat"], [data-icon="chat"]')?.closest('button, [role="button"]');
}
function contactSearch(doc) {
  const candidates = [...doc.querySelectorAll('input, [contenteditable="true"][role="textbox"]')].filter(node =>
    visible(node) && !node.closest('#main, #pluginwhat-panel-host'));
  // Prefer the new-conversation field over the ordinary chat history search box.
  return candidates.find(node => /(?:nome|name|número|number)/i.test(`${node.getAttribute('aria-label') || ''} ${node.getAttribute('placeholder') || ''}`)) ||
    candidates.find(node => node.closest('[data-testid="drawer-left"], [data-testid="new-chat-drawer"], [role="dialog"]')) ||
    (candidates.length === 1 ? candidates[0] : null);
}
const CONTACT_ROWS = '[role="listitem"], [role="row"], [data-testid="cell-frame-container"]';
function contactResultScope(search, doc) {
  const drawer = search.closest('[data-testid="drawer-left"], [data-testid="new-chat-drawer"], [role="dialog"]');
  if (drawer) return drawer;
  // Some WhatsApp versions omit drawer test IDs. Stay in the nearest search/results
  // container rather than considering unrelated rows from the open conversation.
  for (let node = search.parentElement; node && node !== doc.documentElement; node = node.parentElement) {
    if (node.querySelector('#main')) break;
    if (node.querySelector(CONTACT_ROWS)) return node;
  }
  return null;
}
export async function openConversation(job, { doc = document, cancelled = () => false, timeout = 20000 } = {}) {
  checkCancelled(cancelled);
  const button = newChatButton(doc);
  if (!visible(button)) throw new Error('O botão Nova conversa não foi encontrado. Confira o WhatsApp e retome.');
  button.click();
  const search = await until(() => contactSearch(doc), timeout, cancelled);
  replaceEditable(search, `+${job.phone}`, doc);
  const result = await until(() => {
    const scope = contactResultScope(search, doc);
    if (!scope) return null;
    const rows = [...scope.querySelectorAll(CONTACT_ROWS)].filter(node =>
      visible(node) && !node.closest('#main') && !/not on whatsapp|não está no whatsapp|convidar|invite/i.test(node.innerText));
    // Collapse nested wrappers of the same result before considering a single saved contact.
    const unique = rows.filter(node => !rows.some(other => other !== node && node.contains(other)));
    const exact = unique.filter(node => phoneIn(node.innerText, job.phone) ||
      [...node.querySelectorAll('[title]')].some(title => phoneIn(title.getAttribute('title'), job.phone)));
    if (exact.length === 1) return exact[0];
    // A saved contact can show only a name. Its number is verified in prepare BEFORE writing.
    return unique.length === 1 && unique[0];
  }, timeout, cancelled);
  checkCancelled(cancelled);
  result.click();
  await until(() => (!result.isConnected || !visible(result)) && visible(composer(doc)), timeout, cancelled);
}

export async function prepare(job, { doc = document, cancelled = () => false, timeout = 60000, fillMessage = false } = {}) {
  const main = await until(() => {
    const root = doc.querySelector('#main');
    const box = composer(doc);
    return isLoggedIn(doc) && visible(root) && visible(box) &&
      (fillMessage || normalizeText(box.innerText) === normalizeText(job.message)) && root;
  }, timeout, cancelled);
  const header = main.querySelector('header');
  if (!header) throw new Error('Cabeçalho da conversa não encontrado.');
  let verified = phoneIn(header.innerText, job.phone);
  if (!verified) {
    const trigger = header.querySelector('[data-testid="conversation-info-header-chat-title"], [data-testid="conversation-info-header"], [title]') || header.querySelector('[role="button"]');
    if (!trigger) throw new Error('Não foi possível abrir os dados do contato para conferir o número.');
    trigger.click();
    const drawer = await until(() => {
      const node = infoDrawer(doc);
      return visible(node) && node;
    }, Math.min(timeout, 8000), cancelled);
    verified = phoneIn(drawer.innerText, job.phone);
    const close = drawer.querySelector('button[aria-label="Fechar"], [role="button"][aria-label="Fechar"], button[aria-label="Close"], [role="button"][aria-label="Close"]') ||
      drawer.querySelector('[data-icon="x"], [data-icon="x-alt"], [data-icon="back"]')?.closest('button, [role="button"]');
    if (close) close.click();
    if (!verified) throw new Error('O número exibido nos dados do contato não corresponde ao destinatário. Nenhuma mensagem foi enviada.');
    if (!close) throw new Error('Feche os dados do contato e retome a sequência.');
  }
  checkCancelled(cancelled);
  if (fillMessage) {
    const box = composer(doc);
    if (!visible(box)) throw new Error('O editor da conversa não foi encontrado.');
    const existing = normalizeText(box.innerText);
    if (existing && existing !== normalizeText(job.message)) throw new Error('Este contato já tem um rascunho diferente. Confira a conversa antes de retomar.');
    if (existing !== normalizeText(job.message)) replaceEditable(box, job.message, doc);
    await until(() => normalizeText(composer(doc)?.innerText) === normalizeText(job.message) && visible(sendButton(doc)), Math.min(timeout, 5000), cancelled);
  }
  const box = composer(doc), button = sendButton(doc);
  if (!visible(box) || !visible(button) || normalizeText(box.innerText) !== normalizeText(job.message)) {
    throw new Error('A mensagem ou o botão de envio mudou. Confira a conversa e retome.');
  }
  return { main, header, headerText: header.innerText, box, button };
}

export async function sendPrepared(job, snapshot, { doc = document, cancelled = () => false, timeout = 15000 } = {}) {
  checkCancelled(cancelled);
  const { main, header, headerText, box, button } = snapshot;
  if (!visible(main) || !visible(header) || !visible(box) || !visible(button) ||
      doc.querySelector('#main') !== main || composer(doc) !== box || sendButton(doc) !== button ||
      header.innerText !== headerText || normalizeText(box.innerText) !== normalizeText(job.message)) {
    throw new Error('A conversa mudou antes do envio. Confira o resultado antes de continuar.');
  }
  // Count matching outgoing bubbles before clicking; an old identical message is insufficient evidence.
  const matching = () => [...main.querySelectorAll('.message-out')].filter(node =>
    [...node.querySelectorAll('[data-testid="msg-text"], .selectable-text')].some(text => normalizeText(text.innerText) === normalizeText(job.message)));
  const before = new Set(matching());
  button.click(); // Exactly one click. Never retry an ambiguous send.
  await until(() => {
    if (!main.isConnected || header.innerText !== headerText) throw new Error('A conversa mudou após o clique. Confira o envio.');
    const fresh = matching().find(node => !before.has(node));
    // A clock is still queued locally. Require WhatsApp's sent/delivered acknowledgement.
    return normalizeText(box.innerText) === '' && fresh &&
      fresh.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]');
  }, timeout, cancelled);
}
