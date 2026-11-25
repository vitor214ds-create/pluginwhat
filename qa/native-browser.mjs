import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// This validates the actual DOM/event implementation in Chromium. It is deliberately
// separate from extension/WhatsApp end-to-end acceptance: no real account is used.
export async function runNativeBrowserAudit(options = {}) {
  const { chromium } = options.playwright || await import('playwright');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = createServer(async (request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="pt-BR"><body></body></html>'); return; }
    if (!['/extension/whatsapp.js', '/extension/core.js'].includes(request.url)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(root + request.url));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: options.executablePath || process.env.CHROMIUM_EXECUTABLE_PATH,
      args: options.args || ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin);
    const results = await page.evaluate(async () => {
      const adapter = await import('/extension/whatsapp.js');
      const results = [];
      const check = (condition, name) => { if (!condition) throw new Error(name); results.push(name); };
      document.body.innerHTML = '<div id="text">Bom dia <img alt="🌱"><div>Tudo bem?</div><div><br></div><div>Até logo.</div></div>';
      check(adapter.normalizeText(adapter.readText(document.querySelector('#text'))) === 'Bom dia 🌱\nTudo bem?\n\nAté logo.', 'Real DOM: emoji and block line breaks');
      const phone = '5511912345678';
      for (const mode of ['true', 'plaintext-only']) {
        document.body.innerHTML = `<div id="pane-side"></div><section id="main"><header><span title="Maria da Silva" dir="auto">Maria da Silva</span><span id="presence">online</span></header><div role="contentinfo"><div contenteditable="${mode}" role="textbox" data-lexical-editor="true" aria-label="Digite uma mensagem" style="min-height:30px"></div><button aria-label="Enviar mensagem">Enviar</button></div></section>`;
        const title = document.querySelector('header span[title]');
        title.addEventListener('click', () => {
          const drawer = document.createElement('aside');
          drawer.innerHTML = `<header><h2>Dados do contato</h2><button aria-label="Fechar">Fechar</button></header><p>Telefone: +${phone}</p>`;
          drawer.querySelector('button').addEventListener('click', () => drawer.remove()); document.body.append(drawer);
        });
        // Force the execCommand fallback, which jsdom cannot implement natively.
        document.querySelector('[contenteditable]').addEventListener('paste', event => event.preventDefault());
        const job = { phone, message: 'Bom dia (nome)!\nOferta 🌱\nAté logo.' };
        let snapshot;
        try { snapshot = await adapter.prepare(job, { fillMessage: true, timeout: 2000 }); }
        catch (error) { throw new Error(`Native compose (${mode}): ${error.message}`); }
        check(snapshot.message === 'Bom dia Maria da Silva!\nOferta 🌱\nAté logo.', `Native insertion + personalization (${mode})`);
        let clicks = 0;
        document.querySelector('[aria-label="Enviar mensagem"]').addEventListener('click', () => {
          clicks++; document.querySelector('[contenteditable]').replaceChildren();
          document.querySelector('#presence').textContent = 'digitando…';
          const bubble = document.createElement('div'); bubble.className = 'message-out'; bubble.dataset.id = `true_${phone}@c.us_NEW`;
          bubble.innerHTML = '<span class="selectable-text">Bom dia Maria da Silva!<div>Oferta <img alt="🌱"></div><div>Até logo.</div></span><span data-icon="msg-check"></span>';
          document.querySelector('#main').append(bubble);
        });
        const evidence = await adapter.sendPrepared({ ...job, message: snapshot.message }, snapshot, { timeout: 2000 });
        check(evidence.confirmed && clicks === 1, `Single activation + acknowledged multiline emoji (${mode})`);
      }
      document.body.innerHTML = `<aside><div role="row">Maria<br>+${phone}<br>Este número não está no WhatsApp.</div></aside>`;
      check(adapter.unregisteredEvidence(document, { phone }, document.querySelector('aside')) === null, 'Profile text cannot skip a valid recipient');
      return results;
    });
    for (const result of results) console.log('PASS', result);
    console.log(`${results.length} native Chromium checks passed. No WhatsApp session was accessed.`);
    return results;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runNativeBrowserAudit();
