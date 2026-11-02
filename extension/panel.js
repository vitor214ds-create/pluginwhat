import { parseContacts, validateConfig, summarize, STATE_KEY, DRAFT_KEY } from './core.js';

const $ = id => document.getElementById(id);
const messages = [0, 1, 2].map(i => $(`message-${i}`));
let state = null, contacts = [], rawText = '', report = null, fileName = '', saveTimer, busy = false;
const statuses = { running: 'Em andamento', paused: 'Pausado', completed: 'Concluído', stopped: 'Encerrado' };
const rowStatuses = { sent: 'Enviado', pending: 'Pendente', invalid: 'Não cadastrado', skipped: 'Pulado na versão anterior', uncertain: 'Conferir envio' };
function showError(error) { $('error').textContent = error?.message || String(error); $('error').hidden = false; }
async function command(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw new Error(result?.error || 'A extensão foi recarregada. Atualize esta aba do WhatsApp.');
  if ('state' in result) { state = result.state; renderState(); }
  return result;
}
function intervalSeconds() { return Number($('minutes').value) * 60 + Number($('seconds').value); }
function config() { return { contacts, messages: messages.map(node => node.value), intervalSeconds: intervalSeconds() }; }
function draft() {
  return { contacts, rawText, fileName, messages: messages.map(node => node.value),
    minutes: $('minutes').value, seconds: $('seconds').value, brazil: $('brazil').checked };
}
async function persistDraft() { clearTimeout(saveTimer); await chrome.storage.local.set({ [DRAFT_KEY]: draft() }); }
function changed() {
  messages.forEach((node, index) => { $(`counter-${index}`).textContent = `${node.value.length} / 3000`; });
  const gap = intervalSeconds(), total = contacts.length;
  $('estimate').textContent = total && Number.isFinite(gap) && gap >= 30 && gap <= 86400 ?
    `Tempo mínimo de espera da lista: ${formatDuration(Math.max(0, total - 1) * gap)} + abertura e envio das conversas.` : '';
  renderButtons();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => persistDraft().catch(showError), 300);
}
function formatDuration(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(n / 3600), mins = Math.floor(n % 3600 / 60), secs = n % 60;
  return `${hours ? `${hours} h ` : ''}${mins ? `${mins} min ` : ''}${secs || (!hours && !mins) ? `${secs} s` : ''}`.trim();
}
function renderImport() {
  $('import-summary').textContent = report ? `${fileName} · ${contacts.length} válidos · ${report.duplicates} duplicados removidos · ${report.invalid.length} inválidos ignorados` : 'Nenhum arquivo selecionado.';
  $('invalid-details').hidden = !report?.invalid.length;
  $('invalid-list').replaceChildren();
  for (const entry of (report?.invalid || []).slice(0, 30)) {
    const li = document.createElement('li'); li.textContent = `Linha ${entry.line}: ${entry.value}`; $('invalid-list').append(li);
  }
  $('preview').replaceChildren();
  contacts.slice(0, 6).forEach((phone, i) => {
    const row = document.createElement('div'); row.className = 'preview-row';
    const index = document.createElement('small'); index.textContent = String(i + 1).padStart(2, '0');
    const number = document.createElement('span'); number.textContent = `+${phone}`;
    const pill = document.createElement('span'); pill.className = `pill ${['', 'blue', 'violet'][i % 3]}`; pill.textContent = `M${i % 3 + 1}`;
    row.append(index, number, pill); $('preview').append(row);
  });
}
function renderButtons() {
  const active = state && ['running', 'paused'].includes(state.status);
  $('configuration').disabled = Boolean(active || busy);
  $('start').hidden = Boolean(active);
  $('pause').hidden = state?.status !== 'running';
  $('resume').hidden = state?.status !== 'paused';
  $('stop').hidden = !active;
  const uncertain = state?.queue[state.cursor]?.status === 'uncertain';
  $('resume').disabled = busy || uncertain;
  for (const id of ['pause', 'stop', 'retry', 'mark-sent']) $(id).disabled = busy;
  try { validateConfig(config()); $('start').disabled = busy; } catch { $('start').disabled = true; }
  $('clear').disabled = busy || state?.status === 'running';
  $('export').disabled = !state?.queue?.length;
}
function renderState() {
  const counts = summarize(state);
  $('sent').textContent = String(counts.sent);
  $('total').textContent = `de ${counts.total} contatos${counts.skipped ? ` · ${counts.skipped} pulados` : ''}`;
  $('badge').textContent = statuses[state?.status] || 'Pronto para começar'; $('badge').dataset.status = state?.status || '';
  $('progress').max = Math.max(1, counts.total); $('progress').value = counts.processed;
  $('notice').textContent = state?.notice || 'Importe sua lista para montar a sequência.';
  const current = state?.queue[state.cursor];
  $('current').hidden = !current || !['running', 'paused'].includes(state.status);
  $('current').textContent = current ? `Contato ${state.cursor + 1} · ${current.contactName ? current.contactName + ' · ' : ''}+${current.phone} · Mensagem ${current.template + 1}` : '';
  $('review').hidden = state?.status !== 'paused' || !current;
  $('mark-sent').hidden = current?.status !== 'uncertain';
  $('retry').hidden = current?.status !== 'uncertain';
  $('review-text').textContent = current?.status === 'uncertain' ?
    'O envio não pôde ser confirmado. Confira a conversa antes de escolher uma opção. O contato permanece na fila.' : 'Corrija o problema e clique em Retomar. Este contato permanece na fila; ele não será pulado.';
  $('history-empty').hidden = Boolean(state?.queue?.length);
  $('history-list').replaceChildren();
  // Bounded rendering for large lists; CSV always includes the full queue.
  const begin = Math.max(0, (state?.cursor || 0) - 20);
  (state?.queue || []).slice(begin, begin + 50).forEach((row, offset) => {
    const li = document.createElement('li'); li.dataset.status = row.status;
    if (row.detail) li.title = row.detail;
    const number = document.createElement('span'); number.textContent = `${begin + offset + 1}. ${row.contactName ? row.contactName + ' · ' : ''}+${row.phone} · M${row.template + 1}`;
    const status = document.createElement('span'); status.textContent = rowStatuses[row.status] || row.status;
    li.append(number, status); $('history-list').append(li);
  });
  tick(); renderButtons();
}
function tick() {
  $('countdown').textContent = state?.status === 'running' && !state.job && state.nextAt ?
    `Próximo contato automaticamente em ${formatDuration((state.nextAt - Date.now()) / 1000)}` : '';
}
async function action(type, extra) {
  if (busy) return;
  busy = true; $('error').hidden = true; renderButtons();
  try { await command(type, extra); } catch (error) { showError(error); }
  finally { busy = false; renderButtons(); }
}
$('form').addEventListener('submit', event => event.preventDefault());
$('form').addEventListener('input', changed);
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  try {
    $('error').hidden = true;
    if (!/\.txt$/i.test(file.name)) throw new Error('Selecione um arquivo com extensão .txt.');
    if (file.size > 2 * 1024 * 1024) throw new Error('O arquivo deve ter até 2 MB.');
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('Salve o TXT em UTF-8 antes de importar.');
    const parsed = parseContacts(text, $('brazil').checked ? '55' : '');
    rawText = text; fileName = file.name; report = parsed; contacts = parsed.contacts;
    renderImport(); changed(); await persistDraft();
  } catch (error) { showError(error); $('file').value = ''; }
});
$('brazil').addEventListener('change', () => {
  try { if (rawText) { report = parseContacts(rawText, $('brazil').checked ? '55' : ''); contacts = report.contacts; renderImport(); changed(); } }
  catch (error) { showError(error); }
});
document.querySelectorAll('[data-seconds]').forEach(button => button.addEventListener('click', () => {
  $('minutes').value = String(Math.floor(Number(button.dataset.seconds) / 60));
  $('seconds').value = String(Number(button.dataset.seconds) % 60); changed();
}));
$('start').addEventListener('click', async () => {
  if (!$('form').reportValidity()) return;
  try { validateConfig(config()); await persistDraft(); await action('START', { config: config() }); } catch (error) { showError(error); }
});
$('pause').addEventListener('click', () => action('PAUSE'));
$('resume').addEventListener('click', () => action('RESUME'));
$('stop').addEventListener('click', () => action('STOP'));
$('mark-sent').addEventListener('click', () => action('RESOLVE', { resolution: 'sent' }));
$('retry').addEventListener('click', () => action('RESOLVE', { resolution: 'retry' }));
$('clear').addEventListener('click', async () => {
  if (!confirm('Apagar a lista, os textos e o registro desta extensão neste navegador?')) return;
  clearTimeout(saveTimer);
  await action('CLEAR');
  if (!$('error').hidden) return;
  contacts = []; rawText = ''; fileName = ''; report = null;
  messages.forEach(node => { node.value = ''; }); $('minutes').value = '2'; $('seconds').value = '0'; $('file').value = ''; $('brazil').checked = true;
  renderImport(); changed();
});
$('export').addEventListener('click', () => {
  if (!state) return;
  const cell = value => { let text = String(value || ''); if (/^[=+\-@]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
  const lines = ['numero,mensagem,status,concluido_em,nome,etapa,codigo,detalhe'];
  state.queue.forEach(row => lines.push([row.phone, row.template + 1, row.status, row.finishedAt ? new Date(row.finishedAt).toISOString() : '', row.contactName, row.lastStage, row.errorCode, row.detail].map(cell).join(',')));
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pluginwhat-registro.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATE_KEY]) { state = changes[STATE_KEY].newValue || null; renderState(); }
});
try {
  const saved = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY];
  if (saved) {
    rawText = saved.rawText || ''; fileName = saved.fileName || '';
    $('brazil').checked = saved.brazil !== false;
    if (rawText) { report = parseContacts(rawText, $('brazil').checked ? '55' : ''); contacts = report.contacts; }
    messages.forEach((node, i) => { node.value = saved.messages?.[i] || ''; });
    $('minutes').value = saved.minutes ?? '2'; $('seconds').value = saved.seconds ?? '0';
  }
  await command('GET_STATE'); renderImport(); changed();
} catch (error) { showError(error); }
setInterval(tick, 1000);
