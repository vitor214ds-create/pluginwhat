// DOM adapter only: no private WhatsApp APIs, remote scripts or session access.
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function normalizeText(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim(); }
export function readText(node) {
  if (!node) return '';
  if (!node.querySelector?.('img[alt]') || !node.childNodes) return node.innerText ?? node.textContent ?? '';
  const walk = child => {
    if (child.nodeType === 3) return child.textContent;
    if (child.nodeName === 'IMG') return child.getAttribute('alt') || '';
    if (child.nodeName === 'BR') return '\n';
    const text = [...(child.childNodes || [])].map(walk).join('');
    return ['DIV', 'P'].includes(child.nodeName) ? text + '\n' : text;
  };
  return [...node.childNodes].map(walk).join('');
}
function failure(code, message, retryable = false) { return Object.assign(new Error(message), { code, retryable }); }
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
function titleOf(header) {
  const title = header?.querySelector('[data-testid="conversation-info-header-chat-title"], span[title][dir="auto"], span[title]');
  return normalizeText(title?.getAttribute?.('title') || readText(title) || readText(header).split('\n').find(line => line.trim()) || '');
}
function sameConversation(snapshot, doc) {
  const main = doc.querySelector('#main'), header = main?.querySelector('header');
  return visible(main) && visible(header) && titleOf(header) === snapshot.title;
}
function infoDrawer(doc) {
  return doc.querySelector('[data-testid="drawer-right"], [data-testid="contact-info-drawer"], [role="dialog"][aria-label="Contact info"], [role="region"][aria-label="Dados do contato"]');
}
export function sendButton(doc = document) {
  const icon = doc.querySelector('#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"]');
  return icon?.closest('button, [role="button"]') || doc.querySelector('#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"], #main footer [role="button"][aria-label="Enviar"], #main footer [role="button"][aria-label="Send"]');
}
function checkCancelled(cancelled) { if (cancelled()) throw failure('CANCELLED', 'A conversa foi alterada durante a preparação. Sequência pausada.'); }
async function until(check, timeout, cancelled) {
  const deadline = Date.now() + timeout;
  do {
    checkCancelled(cancelled);
    const value = check(); if (value) return value;
    await delay(250);
  } while (Date.now() < deadline);
  throw failure('TIMEOUT', 'Não foi possível verificar a conversa. Confira o número, sua conexão e a sessão do WhatsApp.', true);
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
  if (visible(button)) button.click();
  else if (!contactSearch(doc)) throw failure('CHAT_BUTTON_MISSING', 'O botão Nova conversa não foi encontrado. Confira o WhatsApp e retome.', true);
  const search = await until(() => contactSearch(doc), timeout, cancelled);
  replaceEditable(search, `+${job.phone}`, doc);
  const result = await until(() => {
    const scope = contactResultScope(search, doc);
    const evidence = unregisteredEvidence(doc, job, scope);
    if (evidence) throw Object.assign(failure('UNREGISTERED', 'O WhatsApp confirmou que este número não está cadastrado.'), { evidence });
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

export function unregisteredEvidence(doc, job, scope) {
  const candidates = [scope, ...doc.querySelectorAll('[role="alert"], [role="dialog"]')].filter(Boolean);
  for (const node of candidates) {
    const text = normalizeText(readText(node));
    const explicit = /(?:not|isn['’]t)\s+(?:registered\s+)?on\s+whatsapp|não\s+(?:está|é)\s+(?:cadastrado\s+)?no\s+whatsapp|não\s+(?:usa|utiliza)\s+(?:o\s+)?whatsapp|não\s+tem\s+(?:uma\s+)?conta\s+no\s+whatsapp/i.test(text);
    const numbers = text.match(/\+?\d[\d ().-]{6,}\d/g) || [];
    const search = node === scope ? contactSearch(doc) : null;
    const targetedSearch = search && scope.contains?.(search) && String(search.value ?? readText(search)).replace(/\D/g, '') === job.phone;
    const sameNumber = numbers.length ? numbers.some(number => number.replace(/\D/g, '') === job.phone) : targetedSearch;
    if (visible(node) && explicit && sameNumber) return text.slice(0, 300);
  }
  // An empty search, generic error, invitation button or disconnection is NOT proof.
  return null;
}

export async function prepare(job, { doc = document, cancelled = () => false, timeout = 60000, fillMessage = false } = {}) {
  const main = await until(() => {
    const root = doc.querySelector('#main');
    const box = composer(doc);
    return isLoggedIn(doc) && visible(root) && visible(box) &&
      (fillMessage || normalizeText(readText(box)) === normalizeText(job.message)) && root;
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
    if (!verified) throw failure('RECIPIENT_MISMATCH', 'O número exibido nos dados do contato não corresponde ao destinatário. Nenhuma mensagem foi enviada.');
    if (!close) throw new Error('Feche os dados do contato e retome a sequência.');
  }
  checkCancelled(cancelled);
  if (fillMessage) {
    const box = composer(doc);
    if (!visible(box)) throw new Error('O editor da conversa não foi encontrado.');
    const existing = normalizeText(readText(box));
    if (existing && existing !== normalizeText(job.message)) throw new Error('Este contato já tem um rascunho diferente. Confira a conversa antes de retomar.');
    if (existing !== normalizeText(job.message)) replaceEditable(box, job.message, doc);
    await until(() => normalizeText(readText(composer(doc))) === normalizeText(job.message) && visible(sendButton(doc)), Math.min(timeout, 5000), cancelled);
  }
  const box = composer(doc), button = sendButton(doc);
  if (!visible(box) || !visible(button) || normalizeText(readText(box)) !== normalizeText(job.message)) {
    throw new Error('A mensagem ou o botão de envio mudou. Confira a conversa e retome.');
  }
  return { main, header, title: titleOf(header), box, button };
}

function messageId(node) {
  return node.getAttribute?.('data-id') || node.closest?.('[data-id]')?.getAttribute?.('data-id') || node.querySelector('[data-id]')?.getAttribute?.('data-id') || '';
}
function outgoing(main) { return [...main.querySelectorAll('.message-out')]; }
function messageMatches(node, text) {
  return [...node.querySelectorAll('[data-testid="msg-text"], .selectable-text')].some(part => normalizeText(readText(part)) === normalizeText(text));
}
export async function sendPrepared(job, snapshot, { doc = document, cancelled = () => false, timeout = 60000, onClick = () => {} } = {}) {
  checkCancelled(cancelled);
  const main = doc.querySelector('#main'), box = composer(doc), button = sendButton(doc);
  if (!sameConversation(snapshot, doc) || !visible(box) || !visible(button) ||
      button.disabled || button.getAttribute?.('aria-disabled') === 'true' || normalizeText(readText(box)) !== normalizeText(job.message)) {
    throw failure('BEFORE_CLICK_CHANGED', 'A conversa mudou antes do envio. Nenhum clique foi realizado.', true);
  }
  const before = outgoing(main), beforeIds = new Set(before.map(messageId).filter(Boolean));
  const beforeMatches = before.filter(node => messageMatches(node, job.message));
  let acknowledgement;
  onClick();
  button.click(); // Exactly one click. Never retry an ambiguous send.
  await until(() => {
    const currentMain = doc.querySelector('#main'), currentHeader = currentMain?.querySelector('header');
    if (!visible(currentMain) || !visible(currentHeader) || !titleOf(currentHeader)) return false;
    if (!sameConversation(snapshot, doc)) throw failure('CONVERSATION_CHANGED', 'A conversa mudou após o clique. Confira o envio.');
    const matches = outgoing(doc.querySelector('#main')).filter(node => messageMatches(node, job.message));
    const fresh = matches.filter(node => {
      const id = messageId(node);
      return id ? !beforeIds.has(id) : matches.length > beforeMatches.length && node === matches.at(-1) && !before.includes(node);
    }).at(-1);
    const ack = fresh?.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]');
    if (normalizeText(readText(composer(doc))) === '' && ack) {
      acknowledgement = { confirmed: true, messageId: messageId(fresh) };
      return true;
    }
    return false;
  }, timeout, cancelled);
  return acknowledgement;
}
