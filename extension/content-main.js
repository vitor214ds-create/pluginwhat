import { isLoggedIn, prepare, sendPrepared, delay } from './whatsapp.js';

export async function start(initialUrl) {
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
  chrome.runtime.onMessage.addListener((request, _sender, reply) => {
    if (request.type === 'PING') reply({ ready: isLoggedIn() });
    if (request.type === 'TOGGLE_PANEL') { frame.hidden = !frame.hidden; toggle.setAttribute('aria-expanded', String(!frame.hidden)); reply({ ok: true }); }
  });
  let cancelled = false, preparing = true, job;
  // A real click or typing in WhatsApp while preparing/sending invalidates the operation.
  const onInteraction = event => { if (event.isTrusted && !event.composedPath().includes(host)) cancelled = true; };
  const onStorage = (changes, area) => {
    const value = changes.pluginwhatCampaign?.newValue;
    if (area === 'local' && changes.pluginwhatCampaign && (!value || value.status !== 'running' || value.job?.id !== job?.id)) cancelled = true;
  };
  try {
    const ready = await chrome.runtime.sendMessage({ type: 'CONTENT_READY', initialUrl });
    job = ready?.job;
    if (!job || !ready.ok) return;
    document.addEventListener('pointerdown', onInteraction, true);
    document.addEventListener('keydown', onInteraction, true);
    chrome.storage.onChanged.addListener(onStorage);
    const snapshot = await prepare(job, { cancelled: () => cancelled });
    const approved = await chrome.runtime.sendMessage({ type: 'PREPARED', jobId: job.id });
    if (approved.ok && approved.approved) preparing = false;
    if (!approved.ok || !approved.approved || cancelled) throw new Error(approved.error || 'Envio cancelado antes do clique.');
    await sendPrepared(job, snapshot, { cancelled: () => cancelled });
    await chrome.runtime.sendMessage({ type: 'RESULT', jobId: job.id, success: true });
  } catch (error) {
    if (job) {
      try { await chrome.runtime.sendMessage({ type: 'RESULT', jobId: job.id, success: false, preparing, error: error.message }); }
      catch { /* The persisted watchdog pauses an interrupted attempt. */ }
    }
  } finally {
    document.removeEventListener('pointerdown', onInteraction, true);
    document.removeEventListener('keydown', onInteraction, true);
    chrome.storage.onChanged.removeListener(onStorage);
  }
  // Yield once so the panel can render even on a busy chat.
  await delay(0);
}
