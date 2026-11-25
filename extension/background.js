import { STATE_KEY, createCampaign, pauseCampaign, resumeCampaign, resolveContact,
  completeContact, skipUnregisteredContact, personalizeMessage, MAX_TEXT_LENGTH } from './core.js';
import { requireSiteSender, decodeSiteCampaign, siteStatus } from './site-bridge.js';
import { createDocumentStore, sameDocumentDescriptor } from './documents.js';
const documentStore = createDocumentStore();
const documentOwner = source => `${source.origin}|${source.clientId}`;

const ALARM = 'pluginwhat-next';
const WATCHDOG = 'pluginwhat-watchdog';
const STAGES = { attaching: 'Anexando o documento HTML da empresa', editor: 'Localizando o campo de mensagem', verifying: 'Conferindo o número e o nome do contato', filling: 'Preenchendo a mensagem', ready: 'Mensagem preenchida; preparando envio', clicking: 'Acionando o botão Enviar', confirming: 'Aguardando a confirmação do WhatsApp' };
let serial = Promise.resolve();
// Every mutation and alarm is serialized. No long-running timers live in the worker.
export function exclusive(operation) {
  const result = serial.then(operation);
  serial = result.catch(() => {});
  return result;
}
async function getState() { return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || null; }
async function save(state, extra = {}) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ ...extra, [STATE_KEY]: state });
  await arm(state);
  if (state.source && ['completed', 'stopped'].includes(state.status)) {
    try { await documentStore.release(documentOwner(state.source), state.queue.flatMap(row => row.attachment ? [row.attachment.id] : [])); } catch { /* A cleanup failure must not undo a confirmed send. */ }
  }
  return state;
}
async function arm(state) {
  if (state?.status === 'running') {
    const due = state.job ? state.job.deadline : state.nextAt;
    if (due != null) await chrome.alarms.create(ALARM, { when: Math.max(Date.now() + 100, due) });
    const watchdog = await chrome.alarms.get(WATCHDOG);
    if (!watchdog) await chrome.alarms.create(WATCHDOG, { periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(ALARM); await chrome.alarms.clear(WATCHDOG);
  }
}
const isWhatsApp = url => { try { return new URL(url).origin === 'https://web.whatsapp.com'; } catch { return false; } };
function requirePanel(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html'))) {
    throw new Error('Comando disponível somente no painel da extensão.');
  }
}
function requireJob(state, sender, request, phase) {
  if (!state || state.status !== 'running' || !state.job || state.job.id !== request.jobId ||
      state.job.phase !== phase || sender.tab?.id !== state.tabId || sender.frameId !== 0 ||
      !isWhatsApp(sender.url) || state.job.deadline <= Date.now() ||
      (state.job.documentId && state.job.documentId !== sender.documentId)) {
    throw new Error('Envio cancelado ou página diferente da sequência.');
  }
}
async function dispatch() {
  const state = await getState();
  if (state?.status !== 'running') return;
  if (state.job) {
    if (Date.now() >= state.job.deadline) await save(pauseCampaign(state, 'Tempo esgotado ao abrir ou confirmar a conversa. Confira o WhatsApp e retome.'));
    else await arm(state);
    return;
  }
  if (state.nextAt > Date.now()) { await arm(state); return; }
  const row = state.queue[state.cursor];
  if (!row) return;
  try {
    const tab = await chrome.tabs.get(state.tabId);
    if (!isWhatsApp(tab.url)) throw new Error('Reabra o WhatsApp Web para retomar.');
    if (state.source && !row.attachment) throw new Error('Esta sequência antiga usa links. Encerre-a e prepare novamente para enviar documentos.');
    if (row.attachment) {
      const savedDocument = await documentStore.descriptor(documentOwner(state.source), row.attachment.id);
      if (!sameDocumentDescriptor(savedDocument, row.attachment)) throw new Error('O documento salvo não corresponde ao contato. Prepare novamente.');
    }
    state.job = { id: crypto.randomUUID(), phone: row.phone, message: row.message ?? state.messages[row.template],
      phase: 'opening', deadline: Date.now() + 120000, ...(row.attachment ? { attachment: row.attachment } : {}) };
    row.attempts = (row.attempts || 0) + 1;
    state.notice = `Abrindo contato ${state.cursor + 1} de ${state.queue.length}.`;
    await save(state);
    const accepted = await chrome.tabs.sendMessage(state.tabId, { type: 'RUN_JOB', jobId: state.job.id }, { frameId: 0 });
    if (!accepted?.accepted) throw new Error('O painel não conseguiu iniciar o contato nesta aba. Confira o WhatsApp e retome.');
  } catch (error) { await save(pauseCampaign(state, error.message)); }
}

export async function handle(request, sender) {
  if (!request || typeof request.type !== 'string') throw new Error('Comando inválido.');
  const state = await getState();
  if (request.type === 'STAGE') {
    if (!STAGES[request.stage] || !state?.job) return {};
    requireJob(state, sender, request, state.job.phase);
    state.job.stage = request.stage; state.queue[state.cursor].lastStage = request.stage;
    state.notice = `${STAGES[request.stage]} · contato ${state.cursor + 1} de ${state.queue.length}.`;
    await save(state); return {};
  }
  if (request.type === 'TICK') {
    if (sender.tab?.id !== state?.tabId || sender.frameId !== 0 || !isWhatsApp(sender.url)) return {};
    return { dispatch: true };
  }
  if (request.type === 'CONTENT_READY') {
    if (!state?.job || state.status !== 'running' || state.job.phase !== 'opening' ||
        sender.tab?.id !== state.tabId || sender.frameId !== 0 || !isWhatsApp(sender.url) ||
        request.jobId !== state.job.id || state.job.deadline <= Date.now()) return { job: null };
    state.job.phase = 'preparing'; state.job.documentId = sender.documentId;
    await save(state); return { job: state.job };
  }
  if (request.type === 'GET_DOCUMENT_CHUNK') {
    requireJob(state, sender, request, 'preparing');
    if (!state.job.attachment || !state.source) throw new Error('Este envio não possui documento.');
    return { base64: await documentStore.chunk(documentOwner(state.source), state.job.attachment.id, request.index) };
  }
  if (request.type === 'PREPARED') {
    requireJob(state, sender, request, 'preparing');
    const contactName = String(request.contactName || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160);
    const message = personalizeMessage(state.job.message, contactName);
    if (!message || message.length > MAX_TEXT_LENGTH || (request.message != null && request.message !== message)) throw new Error('O texto personalizado não corresponde à mensagem configurada. Nenhum envio foi autorizado.');
    if (state.job.attachment && (request.attachmentHash !== state.job.attachment.sha256 || request.fileName !== state.job.attachment.name)) throw new Error('O documento preparado não corresponde ao arquivo desta empresa. Nenhum envio foi autorizado.');
    state.job.message = message; state.queue[state.cursor].contactName = contactName;
    state.job.phase = 'sending'; state.job.deadline = Date.now() + 90000;
    state.lastAttemptAt = Date.now(); state.notice = `Enviando ao contato ${state.cursor + 1}.`;
    await save(state); return { approved: true };
  }
  if (request.type === 'RESULT') {
    if (state?.lastResult?.jobId === request.jobId && sender.tab?.id === state.tabId && sender.frameId === 0 && isWhatsApp(sender.url) &&
        state.lastResult.documentId === sender.documentId) return { accepted: true };
    requireJob(state, sender, request, request.preparing ? 'preparing' : 'sending');
    state.lastResult = { jobId: request.jobId, documentId: sender.documentId };
    const detail = String(request.error || 'Não foi possível confirmar o envio.').slice(0, 400);
    if (!request.success) state.queue[state.cursor].detail = detail;
    if (!request.success) state.queue[state.cursor].errorCode = String(request.errorCode || 'UNKNOWN').slice(0, 80);
    if (request.success && !request.preparing && request.evidence?.confirmed === true &&
        (!state.job.attachment || (request.evidence.attachmentHash === state.job.attachment.sha256 && request.evidence.fileName === state.job.attachment.name))) {
      state.queue[state.cursor].messageId = String(request.evidence.messageId || '').slice(0, 200);
      state.queue[state.cursor].errorCode = '';
      state.queue[state.cursor].detail = state.job.attachment ? 'Documento e legenda confirmados pelo WhatsApp.' : 'Envio confirmado pelo WhatsApp.';
      await save(completeContact(state));
    } else if (request.preparing && request.errorCode === 'UNREGISTERED' && request.unregisteredConfirmed === true) {
      await save(skipUnregisteredContact(state, detail));
    } else if (request.clicked === false && request.retryable === true && (state.queue[state.cursor].attempts || 0) < 3) {
      // Retry this same contact only when no click occurred. Never advance past a valid number.
      state.job = null; state.nextAt = Date.now() + 5000;
      state.notice = 'A abertura falhou antes do envio. Nova tentativa automática neste mesmo contato em 5 segundos.';
      await save(state);
    } else {
      await save(pauseCampaign(state, detail, { uncertain: !request.preparing && request.clicked !== false }));
    }
    return { accepted: true };
  }
  requirePanel(sender);
  if (request.type === 'GET_STATE') return { state };
  if (request.type === 'START') {
    if (state && ['running', 'paused'].includes(state.status)) throw new Error('Encerre a sequência atual antes de iniciar outra.');
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) throw new Error('Abra este painel dentro do WhatsApp Web.');
    const tab = await chrome.tabs.get(tabId);
    if (!isWhatsApp(tab.url)) throw new Error('Abra o WhatsApp Web para iniciar.');
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 });
    if (!ping?.ready) throw new Error('Entre na sua conta e aguarde a lista de conversas aparecer.');
    const created = await save(createCampaign(request.config, tabId));
    return { state: created, dispatch: true };
  }
  if (request.type === 'PAUSE') {
    if (state?.status === 'running') await save(pauseCampaign(state, 'Pausado por você.'));
  } else if (request.type === 'RESUME') {
    const tab = await chrome.tabs.get(sender.tab?.id);
    if (!isWhatsApp(tab.url)) throw new Error('Abra o painel no WhatsApp Web.');
    const ping = await chrome.tabs.sendMessage(tab.id, { type: 'PING' }, { frameId: 0 });
    if (!ping?.ready) throw new Error('Aguarde o WhatsApp carregar.');
    resumeCampaign(state); state.tabId = tab.id; await save(state);
    return { state, dispatch: true };
  } else if (request.type === 'RESOLVE') {
    if (request.resolution === 'sent' && state?.queue[state.cursor]?.status !== 'uncertain') {
      throw new Error('A confirmação manual é apenas para envios incertos.');
    }
    if (state?.status !== 'paused') throw new Error('Não há uma sequência pausada para revisar.');
    const tab = await chrome.tabs.get(sender.tab?.id);
    if (!isWhatsApp(tab.url)) throw new Error('Abra o painel no WhatsApp Web para revisar o envio.');
    const ping = await chrome.tabs.sendMessage(tab.id, { type: 'PING' }, { frameId: 0 });
    if (!ping?.ready) throw new Error('Aguarde o WhatsApp carregar antes de continuar.');
    state.tabId = tab.id;
    await save(resolveContact(state, request.resolution));
    if (state.status === 'paused') { resumeCampaign(state); await save(state); }
    return { state, dispatch: state.status === 'running' };
  } else if (request.type === 'STOP') {
    if (state && ['running', 'paused'].includes(state.status)) {
      pauseCampaign(state, 'Sequência encerrada. Você pode importar outra lista.');
      state.status = 'stopped'; await save(state);
    }
  } else if (request.type === 'CLEAR') {
    if (state?.status === 'running') throw new Error('Pause ou encerre antes de apagar.');
    if (state?.source) await documentStore.release(documentOwner(state.source), state.queue.flatMap(row => row.attachment ? [row.attachment.id] : []));
    await chrome.storage.local.remove([STATE_KEY, 'pluginwhatDraft']);
    await chrome.alarms.clear(ALARM); await chrome.alarms.clear(WATCHDOG); return { state: null };
  } else throw new Error('Comando desconhecido.');
  return { state: await getState() };
}


// The site's origin is checked by Chrome and again here. No generic panel commands are exposed.
export async function handleExternal(request, sender) {
  const origin = requireSiteSender(sender);
  if (request?.protocol !== 'sitehunter-pluginwhat-v2') throw new Error('Protocolo incompatível.');
  const state = await getState();
  const clientId = request.clientId;
  if (typeof clientId !== 'string' || !/^[a-f0-9-]{36}$/i.test(clientId)) throw new Error('Identificação local inválida.');
  const own = state?.source?.origin === origin && state.source.clientId === clientId;
  const findTab = async () => {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    const ready = [];
    for (const tab of tabs) {
      try { if ((await chrome.tabs.sendMessage(tab.id, { type: 'PING' }, { frameId: 0 }))?.ready) ready.push(tab); } catch {}
    }
    return ready.find(t => t.id === state?.tabId) || ready.find(t => t.active) || ready[0];
  };
  if (request.type === 'PING') return { version: chrome.runtime.getManifest().version, protocol: 2, whatsappReady: !!(await findTab()) };
  if (request.type === 'OPEN_WHATSAPP') {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
    else await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
    return {};
  }
  if (request.type === 'GET_STATUS') return { state: own ? siteStatus(state) : null, busy: !own && !!state && ['running', 'paused'].includes(state.status) };
  if (request.type === 'DOCUMENT_BEGIN') {
    const protectedKeys = state?.source && ['running', 'paused'].includes(state.status) ? state.queue.flatMap(row => row.attachment ? [documentStore.key(documentOwner(state.source), row.attachment.id)] : []) : [];
    return await documentStore.begin(`${origin}|${clientId}`, request.document, protectedKeys);
  }
  if (request.type === 'DOCUMENT_CHUNK') return await documentStore.append(`${origin}|${clientId}`, request.documentId, request.index, request.base64);
  if (request.type === 'DOCUMENT_FINISH') return { document: await documentStore.finish(`${origin}|${clientId}`, request.documentId) };
  if (request.type === 'START_CAMPAIGN') {
    const requestId = request.campaign?.requestId;
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('Identificador de campanha inválido.');
    const receiptKey = `${origin}|${clientId}|${requestId}`;
    const receipts = (await chrome.storage.local.get('pluginwhatSiteRequests')).pluginwhatSiteRequests || {};
    if (Object.hasOwn(receipts, receiptKey)) return { state: own && state.id === receipts[receiptKey] ? siteStatus(state) : null, alreadyStarted: true };
    const decoded = decodeSiteCampaign(request.campaign, origin);
    // Replaying a request after a lost response never creates another sequence, even after completion.
    if (own && state.source.requestId === decoded.requestId) return { state: siteStatus(state) };
    if (state && ['running', 'paused'].includes(state.status)) throw new Error('Encerre a sequência atual antes de iniciar outra.');
    for (const row of decoded.recipients) {
      const stored = await documentStore.descriptor(`${origin}|${clientId}`, row.attachment.id);
      if (!sameDocumentDescriptor(stored, row.attachment)) throw new Error('Transfira o documento correto de cada empresa antes de iniciar.');
    }
    const tab = await findTab();
    if (!tab) throw new Error('Abra o WhatsApp Web, entre na conta e atualize a aba após instalar o plugin.');
    const created = createCampaign(decoded.config, tab.id);
    created.source = { origin, clientId, requestId: decoded.requestId };
    created.queue.forEach((row, index) => Object.assign(row, decoded.recipients[index]));
    await save(created, { pluginwhatSiteRequests: { ...receipts, [receiptKey]: created.id } });
    return { state: siteStatus(created), dispatch: true };
  }
  if (!own || request.campaignId !== state.id) throw new Error('Esta sequência não pertence a esta conexão do site.');
  if (request.type === 'PAUSE_CAMPAIGN') {
    if (state.status === 'running') await save(pauseCampaign(state, 'Pausado pelo SiteHunter.'));
  } else if (request.type === 'STOP_CAMPAIGN') {
    if (['running', 'paused'].includes(state.status)) {
      pauseCampaign(state, 'Sequência encerrada pelo SiteHunter.'); state.status = 'stopped'; await save(state);
    }
  } else if (request.type === 'RESUME_CAMPAIGN') {
    const tab = await findTab();
    if (!tab) throw new Error('Conecte o WhatsApp antes de retomar.');
    resumeCampaign(state); state.tabId = tab.id; await save(state);
    return { state: siteStatus(state), dispatch: true };
  } else if (request.type === 'RESOLVE_CONTACT') {
    if (!['sent', 'retry'].includes(request.resolution) || state.status !== 'paused') throw new Error('Revisão inválida.');
    if (request.resolution === 'sent' && state.queue[state.cursor]?.status !== 'uncertain') throw new Error('Revise somente o envio incerto.');
    const tab = await findTab();
    if (!tab) throw new Error('Conecte o WhatsApp antes de revisar.');
    state.tabId = tab.id;
    resolveContact(state, request.resolution);
    if (state.status === 'paused') resumeCampaign(state);
    await save(state);
    return { state: siteStatus(state), dispatch: state.status === 'running' };
  } else throw new Error('Comando de integração desconhecido.');
  return { state: siteStatus(await getState()) };
}
chrome.runtime.onMessageExternal?.addListener((request, sender, reply) => {
  exclusive(() => handleExternal(request, sender)).then(result => {
    reply({ ok: true, ...result });
    if (result.dispatch) void exclusive(dispatch);
  }).catch(error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  exclusive(() => handle(request, sender)).then(result => {
    reply({ ok: true, ...result });
    if (result.dispatch) void exclusive(dispatch);
  }).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if ([ALARM, WATCHDOG].includes(alarm.name)) void exclusive(dispatch); });
chrome.tabs.onRemoved.addListener(tabId => void exclusive(async () => {
  const state = await getState();
  if (state?.tabId === tabId && state.status === 'running') await save(pauseCampaign(state, 'A aba foi fechada. Abra o painel em outra aba do WhatsApp para retomar.'));
}));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  void exclusive(async () => {
    const state = await getState();
    if (state?.tabId === tabId && state.status === 'running' && !isWhatsApp(change.url)) {
      await save(pauseCampaign(state, 'A aba saiu do WhatsApp. Sequência pausada.'));
    }
  });
});
chrome.action.onClicked.addListener(async tab => {
  if (isWhatsApp(tab.url)) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, { frameId: 0 }); }
    catch (error) { console.warn('O painel não está disponível nesta aba do WhatsApp.', error); }
  } else await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
});
chrome.runtime.onStartup.addListener(() => void exclusive(async () => {
  const state = await getState();
  if (state?.status === 'running') await save(pauseCampaign(state, 'O Chrome foi reiniciado. Confira a conversa e retome pelo painel.'));
}));
// storage.session survives worker suspension, but clears when Chrome/the extension restarts.
// Reopening Chrome must not silently resume an abandoned campaign.
void exclusive(async () => {
  const session = await chrome.storage.session.get('pluginwhatWorkerSession');
  const state = await getState();
  if (!session.pluginwhatWorkerSession) {
    await chrome.storage.session.set({ pluginwhatWorkerSession: true });
    if (state?.status === 'running') {
      await save(pauseCampaign(state, 'O navegador ou a extensão foi reiniciado. Confira a conversa e retome.'));
      return;
    }
  }
  await arm(state);
});
