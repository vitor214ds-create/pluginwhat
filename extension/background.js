import { STATE_KEY, createCampaign, pauseCampaign, resumeCampaign, resolveContact,
  completeContact, skipUnregisteredContact } from './core.js';

const ALARM = 'pluginwhat-next';
const WATCHDOG = 'pluginwhat-watchdog';
let serial = Promise.resolve();
// Every mutation and alarm is serialized. No long-running timers live in the worker.
export function exclusive(operation) {
  const result = serial.then(operation);
  serial = result.catch(() => {});
  return result;
}
async function getState() { return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || null; }
async function save(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [STATE_KEY]: state });
  await arm(state);
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
    state.job = { id: crypto.randomUUID(), phone: row.phone, message: state.messages[row.template],
      phase: 'opening', deadline: Date.now() + 120000 };
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
  if (request.type === 'PREPARED') {
    requireJob(state, sender, request, 'preparing');
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
    if (request.success && !request.preparing && request.evidence?.confirmed === true) {
      state.queue[state.cursor].messageId = String(request.evidence.messageId || '').slice(0, 200);
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
    await chrome.storage.local.remove([STATE_KEY, 'pluginwhatDraft']);
    await chrome.alarms.clear(ALARM); await chrome.alarms.clear(WATCHDOG); return { state: null };
  } else throw new Error('Comando desconhecido.');
  return { state: await getState() };
}

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
