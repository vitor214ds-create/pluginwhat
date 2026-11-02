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
}

export function createJobRunner({ host, doc = document, api = chrome,
  actions = { openConversation, prepare, sendPrepared } }) {
  let activeJobId = null;
  return {
    get busy() { return activeJobId !== null; },
    async run(jobId) {
      if (activeJobId !== null) return;
      activeJobId = jobId;
      let cancelled = false, preparing = true, job;
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
        const options = { doc, cancelled: () => cancelled };
        await actions.openConversation(job, options);
        const snapshot = await actions.prepare(job, { ...options, fillMessage: true });
        const approved = await api.runtime.sendMessage({ type: 'PREPARED', jobId: job.id });
        if (approved.ok && approved.approved) preparing = false;
        if (!approved.ok || !approved.approved || cancelled) throw new Error(approved.error || 'Envio cancelado antes do clique.');
        await actions.sendPrepared(job, snapshot, options);
        await api.runtime.sendMessage({ type: 'RESULT', jobId: job.id, success: true });
      } catch (error) {
        if (job) {
          try { await api.runtime.sendMessage({ type: 'RESULT', jobId: job.id, success: false, preparing, error: error.message }); }
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
