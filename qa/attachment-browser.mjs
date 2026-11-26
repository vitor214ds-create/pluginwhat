import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=new Map([['/wa-document.html','qa/browser-fixture/wa-document.html'],...['whatsapp.js','core.js','documents.js'].map(name=>['/pluginwhat/'+name,'extension/'+name])]);
export async function runAttachmentBrowserTests(cases=[
 'ok','existing-input','document-menu','document-menu-en','delayed-input','multiple-inputs','scoped-input',
 'text-accept','drop-only','drop-no-trigger','editable-empty','editable-plain','send-light','send-file','generic-preview','pointer-only',
 'caption-changed','conversation-changed','cancelled','draft','existing-dialog','no-input','no-preview',
 'wrong-file','old-clock','plain-text','quoted-document','hidden-document','hidden-tick','contact-after-click'
]){
 const server=createServer(async(req,res)=>{const path=files.get(new URL(req.url,'http://localhost').pathname);if(!path){res.writeHead(404).end();return;}try{const value=await readFile(root+path);res.setHeader('Content-Type',path.endsWith('.html')?'text/html;charset=utf-8':'text/javascript;charset=utf-8');res.end(value);}catch{res.writeHead(500).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):[]});
  const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/wa-document.html');await page.waitForFunction(()=>typeof window.qaDocumentCase==='function');
  for(const mode of cases){
   const result=await page.evaluate(mode=>window.qaDocumentCase(mode),mode);
   const blocked=['caption-changed','conversation-changed','cancelled','draft','existing-dialog','no-input','no-preview'].includes(mode);
   const uncertain=['wrong-file','old-clock','plain-text','quoted-document','hidden-document','hidden-tick','contact-after-click'].includes(mode);
   assert.equal(result.ok,!blocked&&!uncertain,JSON.stringify({mode,...result}));
   assert.equal(result.clicks,blocked?0:1,mode);
   assert.equal(result.wrongInput,0,mode);
   assert.ok(result.selected<=1,mode+' selected once');
   assert.equal(result.drops,['drop-only','drop-no-trigger'].includes(mode)?1:0,mode+' drop count');
   if(!blocked){assert.equal(result.selected,1,mode);assert.equal(result.fileName,'Empresa-previa.html');assert.ok(result.fileText.includes('Prévia completa'));}
   if(mode.startsWith('document-menu')||['delayed-input','multiple-inputs','scoped-input'].includes(mode))assert.equal(result.menuClicks,1,mode);
   if(result.ok){assert.equal(result.evidence.confirmed,true);assert.equal(result.evidence.fileName,result.fileName);assert.match(result.evidence.attachmentHash,/^[a-f0-9]{64}$/);}
   console.log('PASS',mode,result.ok?'confirmed':result.code);
  }
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runAttachmentBrowserTests();
