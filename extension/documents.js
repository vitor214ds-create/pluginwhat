export const DOCUMENT_CHUNK_BYTES = 256 * 1024;
export const MAX_DOCUMENT_BYTES = 50_000_000;
export const MAX_STAGED_BYTES = 256_000_000;
export function documentDescriptor(value) {
  if (!value || !/^[a-f0-9-]{36}$/i.test(value.id || '') ||
      typeof value.name !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.html$/.test(value.name) ||
      value.mime !== 'text/html' || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_DOCUMENT_BYTES ||
      !/^[a-f0-9]{64}$/.test(value.sha256 || '')) throw new Error('Documento HTML inválido ou maior que 50 MB. Exporte novamente a prévia.');
  return { id: value.id, name: value.name, mime: value.mime, size: value.size, sha256: value.sha256 };
}
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(DOCUMENT_CHUNK_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Parte do documento inválida.');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const keyOf = (owner, id) => `${owner}|${id}`;

// Blobs/chunks live in the extension origin, never WhatsApp's IndexedDB or chrome.storage JSON.
export function createDocumentStore(factory = () => globalThis.indexedDB) {
  async function open() {
    if (!factory()) throw new Error('Armazenamento de documentos indisponível neste navegador.');
    const value = factory().open('pluginwhat-documents', 1);
    value.onupgradeneeded = () => {
      value.result.createObjectStore('documents', { keyPath: 'key' });
      value.result.createObjectStore('chunks', { keyPath: ['key', 'index'] }).createIndex('document', 'key');
    };
    return request(value);
  }
  async function operation(stores, mode, fn) {
    const db = await open();
    try {
      const tx = db.transaction(stores, mode);
      const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Gravação cancelada.')); });
      // Register rejection handling before awaiting requests in the transaction.
      complete.catch(() => {});
      const result = await fn(tx);
      await complete; return result;
    } finally { db.close(); }
  }
  const get = key => operation(['documents'], 'readonly', tx => request(tx.objectStore('documents').get(key)));
  const put = row => operation(['documents'], 'readwrite', tx => request(tx.objectStore('documents').put(row)));
  async function removeKeys(keys) {
    if (!keys.length) return;
    await operation(['documents', 'chunks'], 'readwrite', async tx => {
      for (const key of keys) {
        tx.objectStore('documents').delete(key);
        const chunks = await request(tx.objectStore('chunks').index('document').getAllKeys(key));
        chunks.forEach(chunk => tx.objectStore('chunks').delete(chunk));
      }
    });
  }
  return {
    async begin(owner, value, protectedKeys = []) {
      const descriptor = documentDescriptor(value), key = keyOf(owner, descriptor.id);
      const rows = await operation(['documents'], 'readonly', tx => request(tx.objectStore('documents').getAll()));
      const expired = rows.filter(row => Date.now() - row.updatedAt > 86400000 && !protectedKeys.includes(row.key));
      await removeKeys(expired.map(row => row.key));
      const current = rows.find(row => row.key === key && !expired.includes(row));
      if (current) {
        if (JSON.stringify(current.descriptor) !== JSON.stringify(descriptor)) throw new Error('O documento mudou durante a transferência. Gere novamente.');
        return { ready: current.ready, nextIndex: current.nextIndex };
      }
      if (rows.filter(row => !expired.includes(row)).reduce((n, row) => n + row.descriptor.size, 0) + descriptor.size > MAX_STAGED_BYTES) throw new Error('Os documentos ultrapassam 256 MB no plugin. Encerre a sequência anterior ou reduza os arquivos/quantidade.');
      await put({ key, owner, descriptor, ready: false, nextIndex: 0, updatedAt: Date.now() });
      return { ready: false, nextIndex: 0 };
    },
    async append(owner, id, index, base64) {
      const key = keyOf(owner, id), row = await get(key);
      if (!row || row.ready || !Number.isSafeInteger(index) || index < 0) throw new Error('Transferência do documento não está aberta.');
      const bytes = base64ToBytes(base64);
      const expected = Math.min(DOCUMENT_CHUNK_BYTES, row.descriptor.size - index * DOCUMENT_CHUNK_BYTES);
      if (bytes.length !== expected || expected <= 0 || index > row.nextIndex) throw new Error('Parte ausente, fora de ordem ou com tamanho incorreto.');
      await operation(['documents', 'chunks'], 'readwrite', async tx => {
        if (index < row.nextIndex) {
          const previous = await request(tx.objectStore('chunks').get([key, index]));
          if (!previous || bytesToBase64(previous.bytes) !== base64) throw new Error('A parte repetida contém dados diferentes.');
          return;
        }
        tx.objectStore('chunks').put({ key, index, bytes });
        tx.objectStore('documents').put({ ...row, nextIndex: index + 1, updatedAt: Date.now() });
      });
      return { nextIndex: Math.max(row.nextIndex, index + 1) };
    },
    async finish(owner, id) {
      const key = keyOf(owner, id), row = await get(key);
      if (!row) throw new Error('Documento não encontrado. Transfira novamente.');
      if (row.ready) return row.descriptor;
      if (row.nextIndex !== Math.ceil(row.descriptor.size / DOCUMENT_CHUNK_BYTES)) throw new Error('A transferência do documento está incompleta.');
      const chunks = await operation(['chunks'], 'readonly', tx => request(tx.objectStore('chunks').index('document').getAll(key)));
      chunks.sort((a, b) => a.index - b.index);
      const bytes = new Uint8Array(row.descriptor.size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk.bytes, offset); offset += chunk.bytes.length; }
      if (offset !== bytes.length || await sha256(bytes) !== row.descriptor.sha256) throw new Error('O arquivo transferido não corresponde ao HTML exportado. Nenhum envio foi iniciado.');
      await put({ ...row, ready: true, updatedAt: Date.now() });
      return row.descriptor;
    },
    async descriptor(owner, id) {
      const row = await get(keyOf(owner, id));
      if (!row?.ready) throw new Error('O documento desta empresa não foi transferido por completo. Prepare novamente.');
      return row.descriptor;
    },
    async chunk(owner, id, index) {
      const key = keyOf(owner, id), row = await get(key);
      if (!row?.ready || !Number.isSafeInteger(index) || index < 0 || index >= row.nextIndex) throw new Error('Parte do documento indisponível.');
      const chunk = await operation(['chunks'], 'readonly', tx => request(tx.objectStore('chunks').get([key, index])));
      if (!chunk) throw new Error('O navegador removeu uma parte do documento. Prepare novamente.');
      return bytesToBase64(chunk.bytes);
    },
    release: (owner, ids) => removeKeys([...new Set(ids)].map(id => keyOf(owner, id))),
    key: keyOf,
  };
}
