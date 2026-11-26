import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=new Map([['/fixture','qa/browser-fixture/wa-conversation.html'],...['whatsapp.js','core.js','documents.js'].map(n=>['/adapter/'+n,'extension/'+n])]);
export async function serveFixture(){
 const server=createServer(async(req,res)=>{const file=files.get(new URL(req.url,'http://localhost').pathname);if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html;charset=utf-8':'text/javascript;charset=utf-8');res.end(await readFile(root+file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{server,origin:'http://127.0.0.1:'+server.address().port};
}
export async function runConversationBrowser(){
 const {server,origin}=await serveFixture();let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):[]});
  const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  for(const mode of ['plaintext','empty-editable','regular','input','controlled','button-result','nested-controls','persistent-result','stale-result','business','already-open','no-result','wrong-result']){
   await page.goto(origin+'/fixture');const result=await page.evaluate(mode=>qaRun(mode),mode),blocked=['no-result','wrong-result'].includes(mode);
   assert.equal(result.ok,!blocked,JSON.stringify({mode,...result}));assert.equal(result.wrongSelections,0,mode);
   assert.equal(result.sends.length,blocked?0:1,mode);
   if(!blocked){assert.equal(result.sends[0].number,'5511912345678');assert.equal(result.evidence.fileName,'Empresa-previa.html');assert.ok(result.fileText.includes('Documento completo'));assert.ok(result.stages.includes('attaching'));if(mode!=='already-open')assert.ok(result.writes.includes('+5511912345678'));}
   else{assert.equal(result.code,'SEARCH_RESULT_NOT_FOUND');assert.equal(result.selected,0);}
   console.log('PASS full native search/document flow',mode);
  }
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runConversationBrowser();
