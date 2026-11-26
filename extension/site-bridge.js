import { validateConfig, MAX_TEXT_LENGTH } from './core.js';
import { documentDescriptor } from './documents.js';

const SITES = new Set(['https://site-scout-ai-90.lovable.app', 'https://zsites.lovable.app']);
export function requireSiteSender(sender) {
  let url;
  try { url = new URL(sender?.url); } catch { throw new Error('Origem não autorizada.'); }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!local && !SITES.has(url.origin)) || url.username || url.password ||
      (sender.origin && sender.origin !== url.origin) ||
      (sender.frameId != null && sender.frameId !== 0)) throw new Error('Origem não autorizada.');
  return url.origin;
}

export function decodeSiteCampaign(input, origin) {
  if (!input || typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new Error('Identificador de campanha inválido.');
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 500) throw new Error('Selecione entre 1 e 500 contatos.');
  const recipients = input.recipients.map(row => {
    if (typeof row?.placeId !== 'string' || !row.placeId || row.placeId.length > 300 ||
        typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160 ||
        typeof row.city !== 'string' || row.city.length > 120) throw new Error('Dados da empresa inválidos.');
    return { placeId: row.placeId, companyName: row.name.trim(), city: row.city.trim(), attachment: documentDescriptor(row.document) };
  });
  if (new Set(recipients.map(r => r.placeId)).size !== recipients.length) throw new Error('A lista repete empresas.');
  const base = validateConfig({ contacts: input.recipients.map(r => r.phone), messages: input.messages, intervalSeconds: input.intervalSeconds });
  const contactMessages = recipients.map((row, index) => {
    const template = base.messages[index % 3];
    const text = template.replace(/\(\s*(empresa|cidade|previa)\s*\)/gi, (_, key) => ({ empresa: row.companyName, cidade: row.city, previa: '' })[key.toLowerCase()])
      .replace(/https?:\/\/(?:zsites|site-scout-ai-90)\.lovable\.app\/p\/[a-f0-9]{64}/gi, '').trim();
    if (!text || text.length > MAX_TEXT_LENGTH) throw new Error('Preencha a mensagem que acompanhará o documento (até 3.000 caracteres).');
    return text;
  });
  return { requestId: input.requestId, recipients, config: validateConfig({ ...base, contactMessages }) };
}

export function siteStatus(state) {
  if (!state) return null;
  return {
    id: state.id, requestId: state.source?.requestId, status: state.status, cursor: state.cursor,
    nextAt: state.nextAt, notice: state.notice, intervalMs: state.intervalMs,
    queue: state.queue.map(row => ({ placeId: row.placeId, name: row.companyName, phone: row.phone,
      template: row.template, status: row.status, detail: row.detail, finishedAt: row.finishedAt,
      errorCode: row.errorCode, lastStage: row.lastStage,
      document: row.attachment }))
  };
}
