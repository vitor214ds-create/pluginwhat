import { isLoggedIn, openConversation, prepare, sendPrepared } from './whatsapp.js';

export async function start() {
  if (window.__pluginwhatLoaded) return;
  window.__pluginwhatLoaded = true;
  if (!document.documentElement) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const host = document.createElement('div');
  host.id = 'pluginwhat-panel-host';
  host.style.cssText = 'position:fixed!important;inset:0 0 0 auto!important;z-index:2147483646!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial}button{pointer-events:auto;position:fixed;right:16px;top:16px;border:1px solid #478a71;background:#132c25;color:#bffadc;font:bold 13px system-ui;padding:12px 16px;border-radius:30px;cursor:pointer;box-shadow:0 3px 18px #0003}iframe{pointer-events:auto;position:fixed;right:12px;top:66px;width:min(400px,calc(100vw - 24px));height:calc(100dvh - 80px);border:1px solid #294638;border-radius:18px;box-shadow:0 12px 60px #0005;background:#0d1714}iframe[hidden]{display:none}';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.textContent = 'PW · Pluginwhat'; toggle.setAttribute('aria-label', 'Abrir ou recolher painel Pluginwhat');
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('panel.html'); frame.title = 'Pluginwhat — painel de envios';
  toggle.addEventListener('click', () => { frame.hidden = !frame.hidden; toggle.setAttribute('aria-expanded', String(!frame.hidden)); });
  shadow.append(style, toggle, frame); document.documentElement.append(host);
  host.hidden = !isLoggedIn(); toggle.setAttribute('aria-expanded', 'true');
  const observer = new MutationObserver(() => { host.hidden = !isLoggedIn(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const runner = createJobRunner({ host });
  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (request.type === 'PING') reply({ ready: isLoggedIn() });
    if (request.type === 'TOGGLE_PANEL') { frame.hidden = !frame.hidden; toggle.setAttribute('aria-expanded', String(!frame.hidden)); reply({ ok: true }); }
    if (request.type === 'RUN_JOB' && sender.id === chrome.runtime.id) {
      const accepted = !runner.busy && typeof request.jobId === 'string';
      // Acknowledge immediately: authorization is requested after the worker releases its lock.
      reply({ accepted });
      if (accepted) void runner.run(request.jobId);
    }
  });
  void createPageScheduler({ doc: document, api: chrome }).start();
}

export function createPageScheduler({ doc, api, now = Date.now, timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: id => globalThis.clearTimeout(id)
} }) {
  let state = null, timer = null, disposed = false, revision = 0;
  function schedule() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    if (disposed || state?.status !== 'running' || state.job || state.nextAt == null) return;
    timer = timers.setTimeout(wake, Math.max(50, state.nextAt - now()));
  }
  async function wake() {
    timer = null;
    if (disposed || state?.status !== 'running' || state.job) return;
    if (now() < state.nextAt) { schedule(); return; }
    try { await api.runtime.sendMessage({ type: 'TICK' }); } catch { /* Chrome alarm is the independent fallback. */ }
    // Retry only the scheduler wake-up, never a message click.
    if (!disposed && state?.status === 'running' && !state.job) timer = timers.setTimeout(wake, 1000);
  }
  const onStorage = (changes, area) => {
    if (area === 'local' && changes.pluginwhatCampaign) { revision++; state = changes.pluginwhatCampaign.newValue; schedule(); }
  };
  return {
    async start() {
      api.storage.onChanged.addListener(onStorage);
      doc.addEventListener('visibilitychange', schedule);
      const initialRevision = revision;
      const stored = (await api.storage.local.get('pluginwhatCampaign')).pluginwhatCampaign;
      if (revision === initialRevision) state = stored;
      schedule();
    },
    stop() {
      disposed = true; if (timer !== null) timers.clearTimeout(timer);
      api.storage.onChanged.removeListener(onStorage); doc.removeEventListener('visibilitychange', schedule);
    }
  };
}

async function report(api, payload) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await api.runtime.sendMessage(payload);
      if (response?.ok && response.accepted) return;
      throw new Error(response?.error || 'Confirmação do progresso indisponível.');
    } catch (caught) { error = caught; }
  }
  throw error;
}

export function createJobRunner({ host, doc = document, api = chrome,
  actions = { openConversation, prepare, sendPrepared } }) {
  let activeJobId = null;
  return {
    get busy() { return activeJobId !== null; },
    async run(jobId) {
      if (activeJobId !== null) return;
      activeJobId = jobId;
      let cancelled = false, preparing = true, clicked = false, job, result;
      // A real click or typing in WhatsApp while preparing/sending invalidates the operation.
      const onInteraction = event => { if (event.isTrusted && !event.composedPath().includes(host)) cancelled = true; };
      const onStorage = (changes, area) => {
        const value = changes.pluginwhatCampaign?.newValue;
        if (area === 'local' && changes.pluginwhatCampaign && (!value || value.status !== 'running' || value.job?.id !== jobId)) cancelled = true;
      };
      doc.addEventListener('pointerdown', onInteraction, true);
      doc.addEventListener('keydown', onInteraction, true);
      api.storage.onChanged.addListener(onStorage);
      try {
        const ready = await api.runtime.sendMessage({ type: 'CONTENT_READY', jobId });
        job = ready?.job;
        if (!job || !ready.ok || cancelled) return;
        const options = { doc, cancelled: () => cancelled, onClick: () => { clicked = true; },
          onStage: async stage => { try { await api.runtime.sendMessage({ type: 'STAGE', jobId: job.id, stage }); } catch { /* Progress must not interrupt a send. */ } } };
        await actions.openConversation(job, options);
        const snapshot = await actions.prepare(job, { ...options, fillMessage: true });
        const resolvedJob = { ...job, message: snapshot.message ?? job.message };
        const approved = await api.runtime.sendMessage({ type: 'PREPARED', jobId: job.id, message: resolvedJob.message, contactName: snapshot.contactName || '' });
        if (approved.ok && approved.approved) preparing = false;
        if (!approved.ok || !approved.approved || cancelled) throw new Error(approved.error || 'Envio cancelado antes do clique.');
        const evidence = await actions.sendPrepared(resolvedJob, snapshot, options);
        if (!evidence?.confirmed) throw new Error('O WhatsApp não confirmou o envio da mensagem.');
        result = { type: 'RESULT', jobId: job.id, success: true, evidence };
        await report(api, result);
      } catch (error) {
        if (job) {
          // If an acknowledgement was already observed, retry only its report.
          // A lost reply must never turn a confirmed send into another click.
          const payload = result || { type: 'RESULT', jobId: job.id, success: false, preparing, clicked,
            errorCode: error.code || 'UNKNOWN', retryable: error.retryable === true,
            unregisteredConfirmed: error.code === 'UNREGISTERED' && Boolean(error.evidence), error: error.message };
          try { await report(api, payload); }
          catch { /* The persisted watchdog pauses an interrupted attempt. */ }
        }
      } finally {
        doc.removeEventListener('pointerdown', onInteraction, true);
        doc.removeEventListener('keydown', onInteraction, true);
        api.storage.onChanged.removeListener(onStorage);
        activeJobId = null;
      }
    }
  };
}
