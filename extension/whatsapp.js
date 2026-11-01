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

export async function prepare(job, { doc = document, cancelled = () => false, timeout = 60000 } = {}) {
  const main = await until(() => {
    const root = doc.querySelector('#main');
    const box = composer(doc);
    return isLoggedIn(doc) && visible(root) && visible(box) &&
      normalizeText(box.innerText) === normalizeText(job.message) && root;
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
