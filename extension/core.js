export const MAX_CONTACTS = 5000;
export const MAX_TEXT_LENGTH = 3000;
export const MIN_INTERVAL = 30;
export const MAX_INTERVAL = 86400;
export const STATE_KEY = 'pluginwhatCampaign';
export const DRAFT_KEY = 'pluginwhatDraft';

export function normalizePhone(raw, countryCode = '55') {
  const input = String(raw).trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  const explicitInternational = input.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Brazilian local numbers: DDD + 8/9 digits. Other countries must include DDI.
  if (!explicitInternational && countryCode === '55' && [10, 11].includes(digits.length)) {
    digits = countryCode + digits;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith('55') && ![12, 13].includes(digits.length)) return null;
  return digits;
}

export function parseContacts(text, countryCode = '55') {
  if (typeof text !== 'string') throw new Error('O arquivo precisa conter texto.');
  const contacts = [], invalid = [], seen = new Set();
  let duplicates = 0;
  text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach((line, index) => {
    if (!line.trim()) return;
    const phone = normalizePhone(line, countryCode);
    if (!phone) invalid.push({ line: index + 1, value: line.slice(0, 80) });
    else if (seen.has(phone)) duplicates++;
    else { seen.add(phone); contacts.push(phone); }
  });
  if (contacts.length > MAX_CONTACTS) throw new Error(`Use no máximo ${MAX_CONTACTS} contatos por lista.`);
  return { contacts, invalid, duplicates };
}

export function validateConfig(config) {
  if (!Array.isArray(config?.contacts) || !config.contacts.length || config.contacts.length > MAX_CONTACTS) {
    throw new Error('Importe uma lista válida de contatos.');
  }
  const contacts = config.contacts.map(p => normalizePhone(p, ''));
  if (contacts.some((p, i) => !p || p !== config.contacts[i]) || new Set(contacts).size !== contacts.length) {
    throw new Error('A lista contém números inválidos ou repetidos. Importe novamente.');
  }
  if (!Array.isArray(config.messages) || config.messages.length !== 3 ||
      config.messages.some(m => typeof m !== 'string' || !m.trim() || m.length > MAX_TEXT_LENGTH)) {
    throw new Error(`Preencha as três mensagens (até ${MAX_TEXT_LENGTH} caracteres cada).`);
  }
  const intervalSeconds = Number(config.intervalSeconds);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL || intervalSeconds > MAX_INTERVAL) {
    throw new Error('O intervalo deve ficar entre 30 segundos e 24 horas.');
  }
  return { contacts, messages: config.messages.map(m => m.trim()), intervalSeconds };
}

export function createCampaign(config, tabId, now = Date.now()) {
  const clean = validateConfig(config);
  return {
    id: crypto.randomUUID(), status: 'running', tabId,
    messages: clean.messages, intervalMs: clean.intervalSeconds * 1000,
    queue: clean.contacts.map((phone, index) => ({ phone, template: index % 3, status: 'pending' })),
    cursor: 0, job: null, nextAt: now, updatedAt: now, notice: 'Preparando o primeiro contato.'
  };
}

export function pauseCampaign(state, reason) {
  if (!state) return state;
  if (state.job?.phase === 'sending') {
    state.queue[state.cursor].status = 'uncertain';
    state.queue[state.cursor].detail = 'O envio pode ter ocorrido. Confira a conversa antes de continuar.';
  }
  state.status = 'paused'; state.job = null; state.nextAt = null;
  state.notice = reason; state.updatedAt = Date.now();
  return state;
}

export function completeContact(state, now = Date.now()) {
  const row = state.queue[state.cursor];
  row.status = 'sent'; row.finishedAt = now;
  state.cursor++; state.job = null; state.updatedAt = now;
  if (state.cursor >= state.queue.length) {
    state.status = 'completed'; state.nextAt = null; state.notice = 'Sequência concluída.';
  } else {
    state.nextAt = now + state.intervalMs;
    state.notBefore = state.nextAt;
    state.notice = 'Aguardando o intervalo para o próximo contato.';
  }
  return state;
}

export function resumeCampaign(state, now = Date.now()) {
  if (!state || state.status !== 'paused') throw new Error('Não há uma sequência pausada.');
  if (state.queue[state.cursor]?.status === 'uncertain') {
    throw new Error('Confira o envio incerto e marque como enviado ou pule esse contato antes de retomar.');
  }
  state.status = 'running'; state.job = null;
  state.nextAt = Math.max(now, state.notBefore || 0, state.lastAttemptAt ? state.lastAttemptAt + state.intervalMs : now);
  state.notice = 'Sequência retomada.'; return state;
}

export function resolveContact(state, resolution, now = Date.now()) {
  if (state?.status !== 'paused' || !['sent', 'skipped'].includes(resolution)) throw new Error('Pause a sequência para revisar o contato.');
  if (!state.queue[state.cursor]) throw new Error('Não há contato para revisar.');
  Object.assign(state.queue[state.cursor], { status: resolution, finishedAt: now });
  if (resolution === 'sent') state.notBefore = now + state.intervalMs;
  state.cursor++; state.job = null; state.nextAt = null;
  if (state.cursor >= state.queue.length) { state.status = 'completed'; state.notice = 'Sequência concluída.'; }
  else state.notice = 'Contato revisado. Clique em Retomar para continuar.';
  return state;
}

export function jobUrl(job) {
  const url = new URL('https://web.whatsapp.com/send');
  url.searchParams.set('phone', job.phone);
  url.searchParams.set('text', job.message);
  url.searchParams.set('pw_job', job.id);
  return url.href;
}

export function matchesJob(url, job) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://web.whatsapp.com' && parsed.pathname === '/send' &&
      parsed.searchParams.get('pw_job') === job.id && parsed.searchParams.get('phone') === job.phone &&
      parsed.searchParams.get('text') === job.message;
  } catch { return false; }
}

export function summarize(state) {
  const queue = state?.queue || [];
  return { total: queue.length, sent: queue.filter(r => r.status === 'sent').length,
    skipped: queue.filter(r => r.status === 'skipped').length, processed: state?.cursor || 0 };
}
