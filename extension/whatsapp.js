import { personalizeMessage, MAX_TEXT_LENGTH } from './core.js';
// DOM adapter only: no private WhatsApp APIs, remote scripts or session access.
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function normalizeText(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim(); }
export function readText(node) {
  if (!node) return '';
  if (!node.querySelector?.('img[alt]') || !node.childNodes) return node.innerText ?? node.textContent ?? '';
  const blocks = new Set(['DIV', 'P', 'LI']);
  const walk = child => {
    if (child.nodeType === 3) return child.textContent;
    if (['SCRIPT', 'STYLE'].includes(child.nodeName) || child.hidden || child.style?.display === 'none') return '';
    if (child.nodeName === 'IMG') return child.getAttribute('alt') || '';
    if (child.nodeName === 'BR') return '\n';
    return children(child);
  };
  const children = parent => {
    let text = '', previousBlock = false;
    for (const child of parent.childNodes || []) {
      const part = walk(child), block = blocks.has(child.nodeName);
      if (!part) continue;
      if ((block || previousBlock) && text && !text.endsWith('\n')) text += '\n';
      text += part; previousBlock = block;
    }
    return text;
  };
  return children(node);
}
function failure(code, message, retryable = false) { return Object.assign(new Error(message), { code, retryable }); }
export function isLoggedIn(doc = document) { return visible(doc.querySelector('#pane-side, [data-testid="chat-list"]')); }
export function composer(doc = document) {
  const original = doc.querySelector('#main footer [contenteditable="true"][role="textbox"]');
  if (visible(original)) return original;
  const boxes = [...(doc.querySelectorAll?.('#main [contenteditable="true"], #main [contenteditable="plaintext-only"], #main [contenteditable=""]') || [])].filter(node => visible(node) && !node.closest('header, [role="dialog"]'));
  return boxes.find(node => node.matches('[data-lexical-editor="true"], [data-testid="conversation-compose-box-input"], [data-tab="10"]') || /digite uma mensagem|type a message|escreva uma mensagem/i.test(node.getAttribute('aria-label') || '')) ||
    (boxes.length === 1 ? boxes[0] : null);
}
function visible(element) { return Boolean(element && element.isConnected && element.getClientRects().length); }
function phoneIn(text, phone) {
  // Match a complete phone-looking field, never a substring or a group participant.
  const clean = String(text || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\u00a0/g, ' ');
  return clean.split(/\n/).some(line =>
    /^\+?[\d\s().-]+$/.test(line.trim()) && line.replace(/\D/g, '') === phone) ||
    (clean.match(/\+?\d[\d ().-]{6,}\d/g) || []).some(number => number.replace(/\D/g, '') === phone);
}
function titleOf(header) {
  const title = header?.querySelector('[data-testid="conversation-info-header-chat-title"], span[title][dir="auto"], span[title]');
  return normalizeText(title?.getAttribute?.('title') || readText(title) || readText(header).split('\n').find(line => line.trim()) || '');
}
function sameConversation(snapshot, doc) {
  const main = doc.querySelector('#main'), header = main?.querySelector('header');
  const key = conversationKey(main);
  return visible(main) && visible(header) && titleOf(header) === snapshot.title &&
    comparableChatKeysMatch(snapshot.key, key) && !isGroup(main);
}
function comparableChatKeysMatch(before, after) {
  if (!before || !after || before === after) return true;
  const [oldId, oldDomain] = before.split('@'), [newId, newDomain] = after.split('@');
  const phoneDomains = new Set(['c.us', 's.whatsapp.net']);
  if (oldDomain === newDomain || (phoneDomains.has(oldDomain) && phoneDomains.has(newDomain))) return oldId === newId;
  // Different namespaces are not proof of a different recipient without a supported mapping.
  return true;
}
function conversationKey(main) {
  const messages = main?.querySelectorAll?.('[data-id]') || [];
  const keys = [...messages].filter(node => node.matches?.('.message-in, .message-out') || node.querySelector?.('.message-in, .message-out'))
    .map(node => /^(?:true|false)_([^_]+)_/.exec(node.getAttribute('data-id') || '')?.[1]).filter(Boolean);
  return keys.at(-1) || '';
}
function isGroup(main) {
  return /@(?:g\.us|broadcast|newsletter)$/.test(conversationKey(main)) ||
    visible(main?.querySelector?.('header [aria-label="Dados do grupo"], header [aria-label="Informações do grupo"], header [aria-label="Group info"], header [title="Dados do grupo"], header [title="Group info"]'));
}
function closeInfoButton(drawer) {
  return drawer.querySelector('button[aria-label="Fechar"], [role="button"][aria-label="Fechar"], button[aria-label="Close"], [role="button"][aria-label="Close"], button[aria-label="Voltar"], [role="button"][aria-label="Voltar"], button[aria-label="Back"]') ||
    drawer.querySelector('[data-icon="x"], [data-icon="x-alt"], [data-icon="back"], [data-icon="wds-ic-x"], [data-icon="wds-ic-arrow-left"]')?.closest('button, [role="button"]');
}
function infoDrawer(doc) {
  const known = doc.querySelector('[data-testid="drawer-right"], [data-testid="contact-info-drawer"], [role="dialog"][aria-label="Contact info"], [role="region"][aria-label="Dados do contato"]');
  if (visible(known)) return known;
  for (const heading of doc.querySelectorAll?.('h1, h2, [role="heading"], span') || []) {
    if (!visible(heading) || !/^(dados do contato|informações do contato|dados da empresa|informações da empresa|dados comerciais|contact info|contact information|business info|business information)$/i.test(normalizeText(readText(heading)))) continue;
    for (let node = heading.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
      if (node.querySelector('#main')) break;
      if (closeInfoButton(node) && /\+?\d[\d ().-]{6,}\d/.test(readText(node))) return node;
    }
  }
  return null;
}
function usableName(value) {
  const name = normalizeText(value).replace(/^~/, '').trim();
  if (!name || !/\p{L}/u.test(name) || /^(online|digitando.*|typing.*|dados do contato|contact info|informações do contato|whatsapp)$/i.test(name)) return '';
  return name.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}
export function sendButton(doc = document) {
  const icon = doc.querySelector('#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"], #main [data-icon="send"], #main [data-icon="wds-ic-send-filled"]');
  const iconButton = icon?.closest('button, [role="button"]');
  if (visible(iconButton)) return iconButton;
  const labeled = doc.querySelector('#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"], #main footer [role="button"][aria-label="Enviar"], #main footer [role="button"][aria-label="Send"]');
  if (visible(labeled)) return labeled;
  return [...(doc.querySelectorAll?.('#main [data-icon="send"], #main [data-icon="wds-ic-send-filled"]') || [])].map(node => node.closest('button, [role="button"]')).find(visible) ||
    [...(doc.querySelectorAll?.('#main button, #main [role="button"]') || [])].find(node => visible(node) && /^(enviar|enviar mensagem|send|send message)$/i.test(node.getAttribute('aria-label') || ''));
}
function checkCancelled(cancelled) { if (cancelled()) throw failure('CANCELLED', 'A conversa foi alterada durante a preparação. Sequência pausada.'); }
async function until(check, timeout, cancelled, expired = null) {
  const deadline = Date.now() + timeout;
  do {
    checkCancelled(cancelled);
    const value = check(); if (value) return value;
    await delay(250);
  } while (Date.now() < deadline);
  throw expired || failure('TIMEOUT', 'Não foi possível verificar a conversa. Confira o número, sua conexão e a sessão do WhatsApp.', true);
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
async function fillComposer(box, text, doc, cancelled) {
  checkCancelled(cancelled);
  box.focus();
  const view = doc.defaultView;
  // Modern rich-text editors handle paste themselves. No system clipboard access is used.
  if (view?.DataTransfer && view?.ClipboardEvent && box.dispatchEvent) {
    let dispatched = false;
    try {
      const data = new view.DataTransfer(); data.setData('text/plain', text);
      box.dispatchEvent(new view.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
      dispatched = true;
    } catch { /* A browser may expose these constructors while refusing synthetic paste. */ }
    if (dispatched) { await delay(250); checkCancelled(cancelled); }
  }
  if (normalizeText(editableText(box)) !== normalizeText(text)) {
    try { replaceEditable(box, text, doc); }
    catch (error) { if (!view?.InputEvent) throw failure('EDITOR_INSERT_FAILED', 'O contato abriu, mas o editor não aceitou o texto da mensagem.', true); }
    if (view?.InputEvent && box.dispatchEvent) {
      box.dispatchEvent(new view.InputEvent('input', { inputType: 'insertText', data: text, bubbles: true, composed: true }));
    }
  }
  if (normalizeText(editableText(box)) !== normalizeText(text) && view?.InputEvent && box.dispatchEvent) {
    box.dispatchEvent(new view.InputEvent('beforeinput', { inputType: 'insertReplacementText', data: text, bubbles: true, cancelable: true, composed: true }));
    await delay(250); checkCancelled(cancelled);
  }
  if (normalizeText(editableText(box)) !== normalizeText(text)) throw failure('EDITOR_INSERT_FAILED', 'O contato abriu, mas o campo de mensagem continuou vazio ou não aceitou o texto. Nenhum envio foi realizado.', true);
}
function newChatButton(doc) {
  const button = doc.querySelector('[aria-label="Nova conversa"], [title="Nova conversa"], [aria-label="New chat"], [title="New chat"]');
  if (visible(button)) return button;
  return doc.querySelector('[data-icon="new-chat-outline"], [data-icon="new-chat"], [data-icon="chat"]')?.closest('button, [role="button"]');
}
function contactSearch(doc) {
  const candidates = [...doc.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]')].filter(node =>
    visible(node) && !node.disabled && !node.readOnly && !node.closest('#main, #pluginwhat-panel-host') &&
    (!node.matches?.('input') || /^(text|search|tel)$/i.test(node.type || 'text')));
  // Prefer the new-conversation field over the ordinary chat history search box.
  return candidates.find(node => node.closest('[data-testid="drawer-left"], [data-testid="new-chat-drawer"], [role="dialog"]')) ||
    candidates.find(node => /(?:nome|name|número|numero|number|contatos|contacts)/i.test(`${node.getAttribute('aria-label') || ''} ${node.getAttribute('placeholder') || ''}`)) ||
    (candidates.length === 1 ? candidates[0] : null);
}
const CONTACT_ROWS = '[role="listitem"], [role="row"], [data-testid="cell-frame-container"]';
function contactRows(scope, search) {
  if (!scope) return [];
  const allowed = node =>
    visible(node) && !node.closest?.('#main, header') && !node.contains?.(search) &&
    !/^(convidar|invite|novo contato|new contact|novo grupo|new group)$/i.test(node.getAttribute?.('aria-label') || normalizeText(readText(node))) &&
    !node.matches?.('[data-testid="invite-contact"]');
  // A row can contain avatar/call/menu buttons. Keep the contact row itself.
  const rows = [...scope.querySelectorAll(CONTACT_ROWS)].filter(allowed);
  const candidates = rows.length ? rows : [...scope.querySelectorAll('[role="button"], button')].filter(allowed);
  return candidates.filter(node => !candidates.some(other => other !== node && node.contains?.(other)));
}
function hasPhone(text) { return /\+?\d[\d ().-]{6,}\d/.test(String(text || '')); }
function contactResultScope(search, doc) {
  const drawer = search.closest('[data-testid="drawer-left"], [data-testid="new-chat-drawer"], [role="dialog"]');
  if (drawer) return drawer;
  // Some WhatsApp versions omit drawer test IDs. Stay in the nearest search/results
  // container rather than considering unrelated rows from the open conversation.
  for (let node = search.parentElement; node && node !== doc.documentElement; node = node.parentElement) {
    if (node.querySelector('#main')) break;
    if (node.querySelector(CONTACT_ROWS + ', [role="grid"], [role="list"]')) return node;
  }
  return null;
}
export async function openConversation(job, { doc = document, cancelled = () => false, timeout = 20000, onStage = async () => {} } = {}) {
  checkCancelled(cancelled);
  const previousMain = doc.querySelector('#main'), previousHeader = previousMain?.querySelector('header');
  const previousTitle = titleOf(previousHeader), previousKey = conversationKey(previousMain);
  if (visible(composer(doc)) && visible(previousHeader) && !isGroup(previousMain) &&
      (phoneIn(readText(previousHeader), job.phone) || phoneIn(previousTitle, job.phone))) return;
  await onStage('opening');
  const button = newChatButton(doc);
  if (visible(button)) button.click();
  else if (!contactSearch(doc)) throw failure('CHAT_BUTTON_MISSING', 'O botão Nova conversa não foi encontrado. Confira o WhatsApp e retome.', true);
  const search = await until(() => contactSearch(doc), timeout, cancelled,
    failure('SEARCH_INPUT_NOT_FOUND', 'A busca Nova conversa abriu, mas o campo de pesquisar nome ou número não foi reconhecido. Nenhum envio foi realizado.', true));
  const initialRows = new Map(contactRows(contactResultScope(search, doc), search).map(row => [row, normalizeText(readText(row))]));
  await onStage('searching');
  try { await fillComposer(search, `+${job.phone}`, doc, cancelled); }
  catch (error) {
    if (error.code === 'CANCELLED') throw error;
    throw failure('SEARCH_INPUT_REJECTED', 'O campo Nova conversa não aceitou o número. Nenhum contato foi aberto e nenhum envio foi realizado.', true);
  }
  const searchedAt = Date.now();
  const result = await until(() => {
    if (String(search.value ?? readText(search)).replace(/\D/g, '') !== job.phone) return null;
    const scope = contactResultScope(search, doc);
    const evidence = unregisteredEvidence(doc, job, scope);
    if (evidence) throw Object.assign(failure('UNREGISTERED', 'O WhatsApp confirmou que este número não está cadastrado.'), { evidence });
    if (!scope) return null;
    if ([...(scope.querySelectorAll?.('[role="progressbar"], [aria-busy="true"]') || [])].some(visible)) return null;
    const unique = contactRows(scope, search);
    const exact = unique.filter(node => phoneIn(readText(node), job.phone) ||
      [...node.querySelectorAll('[title]')].some(title => phoneIn(title.getAttribute('title'), job.phone)));
    if (exact.length === 1) return exact[0];
    // A saved contact can show only a name. Its number is verified in prepare BEFORE writing.
    const only = unique.length === 1 && unique[0];
    return only && !hasPhone(readText(only)) && ![...only.querySelectorAll('[title]')].some(node => hasPhone(node.getAttribute('title'))) &&
      (!initialRows.has(only) || initialRows.get(only) !== normalizeText(readText(only))) && Date.now() - searchedAt >= Math.min(500, timeout / 2) && only;
  }, timeout, cancelled, failure('SEARCH_RESULT_NOT_FOUND', 'O número foi preenchido, mas o WhatsApp não apresentou um resultado seguro para abrir. Confira conexão e busca. O contato permanece na fila.', true));
  checkCancelled(cancelled);
  await onStage('selecting');
  result.click();
  await onStage('editor');
  try { await until(() => {
    const main = doc.querySelector('#main'), header = main?.querySelector('header');
    return visible(composer(doc)) && visible(header) && ((!result.isConnected || !visible(result)) ||
      main !== previousMain || header !== previousHeader || titleOf(header) !== previousTitle || conversationKey(main) !== previousKey ||
      phoneIn(readText(header), job.phone) || phoneIn(titleOf(header), job.phone));
  }, timeout, cancelled); }
  catch (error) {
    if (error.code === 'CANCELLED') throw error;
    throw failure('EDITOR_NOT_FOUND', 'O contato abriu, mas o campo de mensagem não foi localizado nesta versão do WhatsApp.', true);
  }
}

export function unregisteredEvidence(doc, job, scope) {
  const candidates = [scope, ...doc.querySelectorAll('[role="alert"], [role="dialog"]')].filter(Boolean);
  for (const node of candidates) {
    // User-controlled names/about text in a real contact row are not a platform error.
    if (node === scope && [...(scope.querySelectorAll?.(CONTACT_ROWS) || [])].some(visible)) continue;
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

export async function prepare(job, { doc = document, cancelled = () => false, timeout = 60000, fillMessage = false, attachmentFile = null, onStage = async () => {} } = {}) {
  await onStage('verifying');
  const main = await until(() => {
    const root = doc.querySelector('#main');
    const box = composer(doc);
    return isLoggedIn(doc) && visible(root) && visible(box) &&
      (fillMessage || normalizeText(readText(box)) === normalizeText(job.message)) && root;
  }, timeout, cancelled);
  const header = main.querySelector('header');
  if (!header) throw new Error('Cabeçalho da conversa não encontrado.');
  if (isGroup(main)) throw failure('GROUP_NOT_ALLOWED', 'A conversa aberta é um grupo ou canal. A sequência só permite contatos individuais.');
  let contactName = usableName(titleOf(header));
  let verified = phoneIn(readText(header), job.phone) || phoneIn(titleOf(header), job.phone);
  if (!verified) {
    const trigger = header.querySelector('[data-testid="conversation-info-header-chat-title"], [data-testid="conversation-info-header"], span[title][dir="auto"], span[dir="auto"]') ||
      header.querySelector('[aria-label="Dados do contato"], [aria-label="Informações do contato"], [aria-label="Dados da empresa"], [aria-label="Contact info"], [aria-label="Business info"]');
    if (!trigger) throw failure('CONTACT_INFO_BUTTON_MISSING', 'A conversa abriu, mas o botão de dados do contato não foi reconhecido para conferir o número. Nenhuma mensagem foi enviada.');
    trigger.click();
    const drawer = await until(() => {
      const node = infoDrawer(doc);
      return visible(node) && hasPhone(readText(node)) && node;
    }, Math.min(timeout, 15000), cancelled, failure('CONTACT_INFO_UNAVAILABLE', 'A conversa abriu, mas os dados do contato ou da empresa não mostraram o telefone para conferência. Nenhum envio foi realizado.', true));
    verified = phoneIn(readText(drawer), job.phone);
    if (!contactName) {
      const profile = drawer.querySelector('[data-testid="contact-info-name"], [data-testid="contact-info-drawer-name"]') ||
        [...(drawer.querySelectorAll?.('span') || [])].find(node => /^~\s*\p{L}/u.test(normalizeText(readText(node))));
      contactName = usableName(readText(profile));
    }
    const close = closeInfoButton(drawer);
    if (close) close.click();
    if (!verified) throw failure('RECIPIENT_MISMATCH', 'O número exibido nos dados do contato não corresponde ao destinatário. Nenhuma mensagem foi enviada.');
    if (!close) throw new Error('Feche os dados do contato e retome a sequência.');
  }
  checkCancelled(cancelled);
  const message = personalizeMessage(job.message, contactName);
  if (!message || message.length > MAX_TEXT_LENGTH) throw failure('PERSONALIZED_MESSAGE_INVALID', 'A mensagem personalizada ficou vazia ou ultrapassou 3.000 caracteres. Ajuste o texto antes de continuar.');
  if (job.attachment) {
    if (!attachmentFile) throw failure('DOCUMENT_MISSING', 'O documento desta empresa não está disponível. Nenhum envio foi realizado.');
    return prepareDocument(job, { main, header, title: titleOf(header), key: conversationKey(main), message, contactName }, attachmentFile, { doc, cancelled, timeout, onStage });
  }
  if (fillMessage) {
    await onStage('filling'); checkCancelled(cancelled);
    const box = composer(doc);
    if (!visible(box)) throw new Error('O editor da conversa não foi encontrado.');
    const existing = normalizeText(readText(box));
    if (existing && existing !== normalizeText(message)) throw new Error('Este contato já tem um rascunho diferente. Confira a conversa antes de retomar.');
    if (existing !== normalizeText(message)) await fillComposer(box, message, doc, cancelled);
    try {
      await until(() => normalizeText(readText(composer(doc))) === normalizeText(message) && visible(sendButton(doc)) && !sendButton(doc).disabled && sendButton(doc).getAttribute?.('aria-disabled') !== 'true', Math.min(timeout, 8000), cancelled);
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      throw failure('EDITOR_NOT_READY', 'O texto foi preenchido, mas o WhatsApp não habilitou o botão Enviar. O contato permanece pendente.', true);
    }
  }
  const box = composer(doc), button = sendButton(doc);
  if (!visible(box) || !visible(button) || normalizeText(readText(box)) !== normalizeText(message)) {
    throw new Error('A mensagem ou o botão de envio mudou. Confira a conversa e retome.');
  }
  await onStage('ready');
  return { main, header, title: titleOf(header), key: conversationKey(main), box, button, message, contactName };
}

function messageId(node) {
  return node.getAttribute?.('data-id') || node.closest?.('[data-id]')?.getAttribute?.('data-id') || node.querySelector('[data-id]')?.getAttribute?.('data-id') || '';
}
function outgoing(main) { return [...main.querySelectorAll('.message-out')]; }
function messageMatches(node, text) {
  return [...node.querySelectorAll('[data-testid="msg-text"], .selectable-text')].some(part => normalizeText(readText(part)) === normalizeText(text));
}
export async function sendPrepared(job, snapshot, { doc = document, cancelled = () => false, timeout = 60000, onClick = () => {}, onStage = async () => {} } = {}) {
  if (job.attachment) return sendDocumentPrepared(job, snapshot, { doc, cancelled, timeout, onClick, onStage });
  await onStage('clicking');
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
  const view = doc.defaultView;
  // Follow one normal pointer activation sequence; never send Enter or retry a click.
  if (view?.MouseEvent && button.dispatchEvent) {
    if (view.PointerEvent) button.dispatchEvent(new view.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
    button.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
    if (view.PointerEvent) button.dispatchEvent(new view.PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
    button.dispatchEvent(new view.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }
  button.click(); // Exactly one click. Never retry an ambiguous send.
  await onStage('confirming');
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


function editableText(node) { return node?.matches?.('input, textarea') ? node.value : readText(node); }
function acceptsDocument(input, file) {
  if (input.disabled) return false;
  const accept = (input.getAttribute('accept') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  if (!accept.length || accept.includes('*') || accept.includes('*/*')) return true;
  const extension = '.' + file.name.split('.').at(-1).toLowerCase();
  return accept.includes(extension) || accept.includes(file.type.toLowerCase()) ||
    accept.some(type => type.endsWith('/*') && file.type.toLowerCase().startsWith(type.slice(0, -1)));
}
function documentInput(doc, file, { scope = null, previous = null } = {}) {
  const candidates = [...doc.querySelectorAll('input[type="file"]')].filter(input => acceptsDocument(input, file));
  if (scope) {
    const associated = scope.getAttribute?.('for') ? doc.getElementById(scope.getAttribute('for')) : null;
    const scoped = candidates.filter(input => scope.contains(input) || input === associated);
    if (scoped.length === 1) return scoped[0];
  }
  const explicit = candidates.filter(input => input.closest('[data-testid="attach-document"], [aria-label="Documento"], [aria-label="Document"], [data-testid="attach-menu-document"]'));
  if (explicit.length === 1) return explicit[0];
  if (previous) {
    const added = candidates.filter(input => !previous.has(input));
    if (added.length === 1) return added[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function documentMenuItem(doc) {
  const names = /^(documento|documentos|document|documents|anexar documento|attach document)$/i;
  const controls = [...doc.querySelectorAll('button, [role="button"], [role="menuitem"], label, li')].filter(node =>
    visible(node) && !node.closest('.message-in, .message-out, #pane-side, #main > header, #pluginwhat-panel-host') &&
    [node.getAttribute('aria-label'), node.getAttribute('title'), readText(node)].some(value => names.test(normalizeText(value))));
  const inner = controls.filter(node => !controls.some(other => other !== node && node.contains(other)));
  return inner.length === 1 ? inner[0] : null;
}
async function locateDocumentInput(doc, file, identity, cancelled, timeout) {
  let input = documentInput(doc, file);
  if (input) return input;
  let option = documentMenuItem(doc);
  if (!option) {
    const main = doc.querySelector('#main');
    const trigger = main?.querySelector('footer [aria-label="Anexar"], footer [aria-label="Attach"], footer [title="Anexar"], footer [title="Attach"]') ||
      main?.querySelector('footer [data-icon="plus"], footer [data-icon="clip"], footer [data-icon="attach-menu-plus"], footer [data-icon="wds-ic-plus-rounded"]')?.closest('button, [role="button"]');
    if (visible(trigger)) {
      trigger.click();
      try {
        await until(() => documentInput(doc, file) || documentMenuItem(doc), Math.min(timeout, 1500), cancelled);
      } catch (error) { if (error.code === 'CANCELLED') throw error; }
    }
    input = documentInput(doc, file); option = documentMenuItem(doc);
    if (input) return input;
  }
  if (!option) return null;
  // Choosing Document can create the input lazily. Wait out transient activation
  // so the application's own input.click() cannot open a native system picker.
  const activatedAt = Date.now();
  while (doc.defaultView?.navigator?.userActivation?.isActive && Date.now() - activatedAt < 6000) {
    checkCancelled(cancelled); await delay(100);
  }
  checkCancelled(cancelled);
  if (doc.defaultView?.navigator?.userActivation?.isActive) return null;
  if (!sameConversation(identity, doc)) throw failure('RECIPIENT_MISMATCH', 'A conversa mudou antes de escolher Documento.');
  const previous = new Set(doc.querySelectorAll('input[type="file"]'));
  option.click();
  try {
    return await until(() => documentInput(doc, file, { scope: option, previous }), Math.min(timeout, 1500), cancelled);
  } catch (error) { if (error.code === 'CANCELLED') throw error; return null; }
}
async function dropDocumentFile(doc, file, identity, cancelled) {
  const view = doc.defaultView, target = composer(doc);
  if (!view?.DataTransfer || !view?.DragEvent || !visible(target)) throw failure('DOCUMENT_INPUT_UNAVAILABLE', 'O WhatsApp não disponibilizou seleção nem soltura de documento nesta conversa. Nenhum envio foi realizado.');
  if (!sameConversation(identity, doc)) throw failure('RECIPIENT_MISMATCH', 'A conversa mudou antes de anexar o documento.');
  const transfer = new view.DataTransfer(); transfer.items.add(file);
  transfer.effectAllowed = 'copy'; transfer.dropEffect = 'copy';
  const bounds = target.getBoundingClientRect();
  const options = { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer,
    clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 };
  target.dispatchEvent(new view.DragEvent('dragenter', options));
  await delay(50); checkCancelled(cancelled);
  target.dispatchEvent(new view.DragEvent('dragover', options));
  await delay(50); checkCancelled(cancelled);
  if (!sameConversation(identity, doc)) throw failure('RECIPIENT_MISMATCH', 'A conversa mudou durante a preparação do documento.');
  // Exactly one drop. Never choose a second upload strategy after dispatching file bytes.
  target.dispatchEvent(new view.DragEvent('drop', options));
}
function scopedSend(scope) {
  const icons = [...scope.querySelectorAll('[data-icon="send"], [data-icon="wds-ic-send-filled"], [data-icon="send-light"], [data-icon="wds-ic-send"]')];
  return icons.map(icon => icon.closest('button, [role="button"]')).find(visible) || [...scope.querySelectorAll('button, [role="button"]')].find(button => visible(button) && /^(enviar|send|enviar mensagem|send message|enviar documento|send document|enviar arquivo|send file)$/i.test(button.getAttribute('aria-label') || ''));
}
function captionBox(scope) {
  return [...scope.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""], textarea, input[type="text"]')].filter(visible).find(node => /legenda|caption|mensagem|message/i.test(node.getAttribute('aria-label') || node.getAttribute('placeholder') || '') || node.matches('[data-lexical-editor], [role="textbox"], textarea'));
}
function visibleAttachmentPart(node) {
  const style = node.ownerDocument.defaultView?.getComputedStyle(node);
  return visible(node) && style?.visibility !== 'hidden' && style?.visibility !== 'collapse' &&
    (!node.checkVisibility || node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) &&
    !node.closest('[data-testid*="quoted"], [data-testid*="quote"], blockquote');
}
function containsFileName(scope, name) {
  return [...scope.querySelectorAll('[title], [data-testid="document-title"], span, div, a[download]')].some(node =>
    visibleAttachmentPart(node) && (scope.closest('.message-out, .message-in') || !node.closest('.message-out, .message-in')) &&
    (node.getAttribute('title') === name || node.getAttribute('download') === name || normalizeText(readText(node)) === name));
}
function outgoingDocumentMatches(node, name, message) {
  const documentPart = [...node.querySelectorAll('[data-testid*="document"], [data-icon="document"], [data-icon^="doc-"], [class*="icon-doc-"], a[download]')].some(visibleAttachmentPart);
  const caption = [...node.querySelectorAll('[data-testid="msg-text"], .selectable-text')].some(part =>
    visibleAttachmentPart(part) && normalizeText(readText(part)) === normalizeText(message));
  return documentPart && caption && containsFileName(node, name);
}
function attachmentPreview(doc, name) {
  const selectors = '[data-testid="media-editor"], [data-testid="document-preview"], [data-testid="media-preview"], [role="dialog"], [data-animate-modal-popup]';
  for (const scope of doc.querySelectorAll(selectors)) {
    if (visible(scope) && !scope.closest('.message-out, .message-in') && containsFileName(scope, name) && scopedSend(scope) && captionBox(scope)) return scope;
  }
  // Some versions omit the modal test ID. Use the smallest bounded ancestor of its exact file name.
  for (const node of doc.querySelectorAll('[title], span')) {
    if (!visible(node) || node.closest('.message-out, .message-in') || !(node.getAttribute('title') === name || normalizeText(readText(node)) === name)) continue;
    for (let scope = node.parentElement, depth = 0; scope && depth < 6; scope = scope.parentElement, depth++) {
      if (scope.id === 'main' || scope.querySelector('#pane-side, #main > header') || scope === doc.body) break;
      if (scopedSend(scope) && captionBox(scope)) return scope;
    }
  }
  return null;
}
async function prepareDocument(job, identity, file, { doc, cancelled, timeout, onStage }) {
  checkCancelled(cancelled);
  if (file.name !== job.attachment.name || file.size !== job.attachment.size || file.type !== 'text/html') throw failure('DOCUMENT_MISMATCH', 'O arquivo não corresponde à prévia desta empresa.');
  if (normalizeText(readText(composer(doc)))) throw failure('EXISTING_DRAFT', 'Esta conversa já tem um rascunho. Confira antes de anexar o documento.');
  const openAttachment = [...doc.querySelectorAll('[data-testid="media-editor"], [data-testid="document-preview"], [data-testid="media-preview"], [role="dialog"], [data-animate-modal-popup]')].some(scope =>
    visible(scope) && !scope.querySelector('#pane-side, #main > header') && (scope.matches('[data-testid="media-editor"], [data-testid="document-preview"], [data-testid="media-preview"]') || (scopedSend(scope) && captionBox(scope))));
  if (openAttachment) throw failure('EXISTING_ATTACHMENT', 'Já existe um anexo aberto. Confira a conversa antes de retomar.');
  await onStage('attaching');
  const input = await locateDocumentInput(doc, file, identity, cancelled, timeout);
  if (!sameConversation(identity, doc)) throw failure('RECIPIENT_MISMATCH', 'A conversa mudou antes de anexar o arquivo.');
  const view = doc.defaultView;
  if (input) {
    if (!view?.DataTransfer) throw failure('DOCUMENT_INPUT_UNAVAILABLE', 'Este navegador não disponibilizou a seleção de documentos.');
    const transfer = new view.DataTransfer(); transfer.items.add(file);
    input.files = transfer.files;
    if (input.files.length !== 1 || input.files[0].name !== file.name || input.files[0].size !== file.size) throw failure('DOCUMENT_MISMATCH', 'O navegador não selecionou o documento correto.');
    input.dispatchEvent(new view.Event('input', { bubbles: true }));
    input.dispatchEvent(new view.Event('change', { bubbles: true }));
  } else {
    await dropDocumentFile(doc, file, identity, cancelled);
  }
  let preview;
  try { preview = await until(() => attachmentPreview(doc, file.name), Math.min(timeout, 20000), cancelled); }
  catch (error) { if (error.code === 'CANCELLED') throw error; throw failure('DOCUMENT_PREVIEW_UNAVAILABLE', 'O WhatsApp não preparou o documento com legenda. Confira o formato e a conversa. Nenhum envio foi realizado.'); }
  if (!sameConversation(identity, doc)) throw failure('RECIPIENT_MISMATCH', 'A conversa mudou durante a preparação do documento.');
  const box = captionBox(preview);
  const existing = normalizeText(editableText(box));
  if (existing && existing !== normalizeText(identity.message)) throw failure('EXISTING_DRAFT', 'O anexo já tem uma legenda diferente. Confira antes de continuar.');
  await onStage('filling');
  if (existing !== normalizeText(identity.message)) await fillComposer(box, identity.message, doc, cancelled);
  const button = await until(() => {
    const send = scopedSend(preview);
    return visible(send) && !send.disabled && send.getAttribute('aria-disabled') !== 'true' && send;
  }, Math.min(timeout, 15000), cancelled);
  if (normalizeText(editableText(box)) !== normalizeText(identity.message) || !containsFileName(preview, file.name)) throw failure('DOCUMENT_MISMATCH', 'O documento ou sua legenda mudou antes do envio.');
  await onStage('ready');
  return { ...identity, kind: 'document', preview, box, button, input, file, attachmentHash: job.attachment.sha256 };
}
async function sendDocumentPrepared(job, snapshot, { doc, cancelled, timeout, onClick, onStage }) {
  await onStage('clicking'); checkCancelled(cancelled);
  const { preview, box, button } = snapshot;
  if (snapshot.kind !== 'document' || snapshot.attachmentHash !== job.attachment.sha256 || !sameConversation(snapshot, doc) ||
      !visible(preview) || attachmentPreview(doc, job.attachment.name) !== preview || scopedSend(preview) !== button ||
      !visible(box) || !visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true' ||
      normalizeText(editableText(box)) !== normalizeText(job.message) || !containsFileName(preview, job.attachment.name)) throw failure('DOCUMENT_BEFORE_CLICK_CHANGED', 'A conversa, o documento ou a legenda mudou antes do envio. Nenhum clique foi realizado.');
  const before = outgoing(doc.querySelector('#main')), beforeIds = new Set(before.map(messageId).filter(Boolean));
  onClick();
  const view = doc.defaultView;
  if (view?.MouseEvent && button.dispatchEvent) {
    if (view.PointerEvent) button.dispatchEvent(new view.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
    button.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
    if (view.PointerEvent) button.dispatchEvent(new view.PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
    button.dispatchEvent(new view.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }
  button.click();
  await onStage('confirming');
  let evidence;
  await until(() => {
    if (!sameConversation(snapshot, doc)) throw failure('CONVERSATION_CHANGED', 'A conversa mudou após o clique do documento. Confira o envio.');
    const fresh = outgoing(doc.querySelector('#main')).filter(node => {
      const id = messageId(node);
      return (id ? !beforeIds.has(id) : !before.includes(node)) && outgoingDocumentMatches(node, job.attachment.name, job.message);
    }).at(-1);
    const ack = fresh?.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]');
    if (ack && visibleAttachmentPart(ack) && !visible(preview)) {
      evidence = { confirmed: true, messageId: messageId(fresh), fileName: job.attachment.name, attachmentHash: job.attachment.sha256 };
      return true;
    }
    return false;
  }, timeout, cancelled);
  return evidence;
}
