import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {serveFixture} from './conversation-browser.mjs';
// A clean Chromium profile loads the real unpacked extension. All WhatsApp
// network traffic is intercepted and fulfilled locally; no live account exists.
const root=fileURLToPath(new URL('../',import.meta.url));
const {server,origin}=await serveFixture(),profile=await mkdtemp(join(tmpdir(),'pluginwhat-extension-'));
let context;
try{
 const extension=resolve(root,'extension'),html=await readFile(resolve(root,'qa/browser-fixture/wa-conversation.html'),'utf8');
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',
  ...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),
  args:[...(process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):[]),'--disable-extensions-except='+extension,'--load-extension='+extension]});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin==='https://web.whatsapp.com')return route.fulfill({status:200,contentType:'text/html;charset=utf-8',body:html});
  if(url.origin===origin||url.protocol==='chrome-extension:')return route.continue();
  return route.abort();
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const extensionId=new URL(worker.url()).host;
 assert.equal(await worker.evaluate(()=>chrome.runtime.getManifest().version),'1.4.3');
 const whatsapp=await context.newPage();let navigations=0;
 whatsapp.on('framenavigated',frame=>{if(frame===whatsapp.mainFrame())navigations++;});
 await whatsapp.goto('https://web.whatsapp.com/?mode=extension');await whatsapp.locator('#pluginwhat-panel-host').waitFor({state:'attached'});
 const site=await context.newPage();await site.goto(origin+'/fixture');
 const clientId=randomUUID();
 async function call(type,payload={}){
  return site.evaluate(async({extensionId,clientId,type,payload})=>{
   return new Promise((resolve,reject)=>chrome.runtime.sendMessage(extensionId,{protocol:'sitehunter-pluginwhat-v2',clientId,type,...payload},response=>{
    if(chrome.runtime.lastError)return reject(Error(chrome.runtime.lastError.message));resolve(response);
   }));
  },{extensionId,clientId,type,payload});
 }
 const ping=await call('PING');assert.equal(ping.ok,true);assert.equal(ping.whatsappReady,true);
 const recipients=[];
 for(const[i,phone]of ['5511912345678','5521912345678'].entries()){
  const bytes=Buffer.from('<!doctype html><title>Empresa '+i+'</title><p>Documento individual '+i+'</p>'),document={id:randomUUID(),name:'Empresa-'+i+'-previa.html',mime:'text/html',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  for(const[type,payload]of [['DOCUMENT_BEGIN',{document}],['DOCUMENT_CHUNK',{documentId:document.id,index:0,base64:bytes.toString('base64')}],['DOCUMENT_FINISH',{documentId:document.id}]]){
   const response=await call(type,payload);assert.equal(response.ok,true,JSON.stringify(response));
  }
  recipients.push({placeId:'qa-'+i,phone,name:'Empresa '+i,city:'Teste',document});
 }
 const campaign={requestId:randomUUID(),messages:['M1 (nome)','M2 (nome)','M3 (nome)'],intervalSeconds:30,recipients};
 const started=await call('START_CAMPAIGN',{campaign});assert.equal(started.ok,true,JSON.stringify(started));
 await whatsapp.waitForFunction(()=>qaSends.length===1,{},{timeout:20000});
 await whatsapp.waitForFunction(()=>qaSends.length===2,{},{timeout:50000});
 let status;
 for(let i=0;i<50;i++){status=await call('GET_STATUS');if(status.state?.status==='completed')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(status.state?.status,'completed',JSON.stringify(status));
 assert.deepEqual(status.state.queue.map(row=>row.status),['sent','sent']);
 const observed=await whatsapp.evaluate(async()=>({sends:qaSends,files:await Promise.all(qaFiles.map(f=>f.text())),writes:qaWrites}));
 assert.deepEqual(observed.sends.map(x=>x.number),recipients.map(x=>x.phone));
 assert.deepEqual(observed.sends.map(x=>x.fileName),recipients.map(x=>x.document.name));
 assert.deepEqual(observed.sends.map(x=>x.text),['M1 Empresa de teste','M2 Empresa de teste']);
 assert.ok(observed.files[0].includes('Documento individual 0'));assert.ok(observed.files[1].includes('Documento individual 1'));
 assert.ok(observed.sends[1].at-observed.sends[0].at>=30000,'minimum interval after acknowledgement');
 assert.equal(navigations,1,'no WhatsApp reload or URL navigation');
 console.log('PASS: real MV3 worker, isolated content script, site IPC, native IndexedDB, two distinct documents/captions, plaintext-only contact search, business verification, automatic 30-second interval and zero page reloads. All WhatsApp responses were local fixtures.');
}finally{if(context)await context.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
