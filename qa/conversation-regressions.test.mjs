import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openConversation,prepare,sendPrepared} from '../extension/whatsapp.js';
const phone='5511912345678',other='5521912345678';
function fixture(t,{editable='true',rowRole='row',controlled=false,business=false,persistent=false,already=false,empty=false,wrong=false,stale=false,prefilled=false}={}){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000000});
 const dom=new JSDOM('<!doctype html><div id="pane-side"><button aria-label="Nova conversa">Nova conversa</button></div><main id="main"></main>',{url:'https://web.whatsapp.com/'}),doc=dom.window.document;
 Object.defineProperty(dom.window.HTMLElement.prototype,'getClientRects',{value(){return this.isConnected&&!this.closest('[hidden]')?[{}]:[];}});
 Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent;},set(v){this.textContent=v;}});
 let clicks=0,selected=0,wrongClicks=0;
 const node=(tag,attrs={},text='')=>{const n=doc.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.textContent=text;return n;};
 dom.window.DataTransfer=class{data={};setData(k,v){this.data[k]=v;}getData(k){return this.data[k]||'';}};
 dom.window.ClipboardEvent=class extends dom.window.Event{constructor(type,opts){super(type,opts);this.clipboardData=opts.clipboardData;}};
 doc.execCommand=(_cmd,_ui,text)=>{const n=doc.activeElement;if(controlled&&n.id==='search')return false;n.textContent=text;n.dispatchEvent(new dom.window.Event('input',{bubbles:true}));return true;};
 function chat(number){
  const main=doc.querySelector('#main');main.replaceChildren();const header=node('header'),title=node('span',{title:business?'Empresa':('+'+number),dir:'auto'},business?'Empresa':('+'+number));header.append(title);main.append(header);
  title.onclick=()=>{const panel=node('aside'),close=node('button',{'aria-label':'Fechar'},'Fechar');close.onclick=()=>panel.remove();panel.append(node('h2',{},business?'Dados da empresa':'Dados do contato'),close,node('div',{},'Telefone: +'+number));doc.body.append(panel);};
  const footer=node('footer'),box=node('div',{contenteditable:'true',role:'textbox',tabindex:'0'}),send=node('button',{'aria-label':'Enviar'},'Enviar');
  send.onclick=()=>{clicks++;const b=node('div',{class:'message-out','data-id':'true_'+number+'@c.us_NEW'});b.append(node('span',{class:'selectable-text'},box.textContent),node('span',{'data-icon':'msg-check'}));main.insertBefore(b,footer);box.textContent='';};footer.append(box,send);main.append(footer);
 }
 doc.querySelector('[aria-label="Nova conversa"]').onclick=()=>{
  const panel=node('aside',{'data-testid':'drawer-left'}),search=node('div',{id:'search',contenteditable:editable,role:'textbox',tabindex:'0','aria-label':'Pesquisar nome ou número'}),grid=node('div',{role:'grid'});panel.append(search,grid);doc.body.append(panel);
  function results(){setTimeout(()=>{grid.replaceChildren();if(empty)return;const row=node('div',{role:rowRole,tabindex:'0'},'+'+(wrong?other:phone));row.onclick=()=>{selected++;if(wrong)wrongClicks++;if(!persistent)panel.remove();chat(wrong?other:phone);};grid.append(row);},stale?700:100);}
  search.addEventListener('input',results);search.addEventListener('paste',e=>{if(!controlled)return;e.preventDefault();search.textContent=e.clipboardData.getData('text/plain');results();});
  if(prefilled){search.textContent='+'+phone;const row=node('div',{role:'row'},'Maria');row.onclick=()=>{selected++;panel.remove();chat(phone);};grid.append(row);}
  if(stale){const old=node('div',{role:rowRole},'Contato anterior');old.onclick=()=>{selected++;wrongClicks++;panel.remove();chat(other);};grid.append(old);}
 };
 if(already)chat(phone);
 t.after(()=>{dom.window.close();t.mock.timers.reset();});
 async function run(operation){let done=false,result,error;operation.then(v=>{done=true;result=v;},e=>{done=true;error=e;});for(let n=0;n<80&&!done;n++){t.mock.timers.tick(250);for(let k=0;k<30;k++)await Promise.resolve();}if(!done)throw Error('Fixture did not settle');if(error)throw error;return result;}
 return{doc,run,clicks:()=>clicks,selected:()=>selected,wrongClicks:()=>wrongClicks};
}
for(const [name,options]of Object.entries({plaintext:{editable:'plaintext-only'},emptyEditable:{editable:''},controlled:{controlled:true},buttonRow:{rowRole:'button'},persistentResult:{persistent:true},alreadyOpen:{already:true},businessInfo:{business:true},staleResult:{stale:true},alreadySearched:{prefilled:true}})){
 test('full search → verify → fill → send: '+name,async t=>{
  const f=fixture(t,options),job={phone,message:'Bom dia (nome)!'};
  await f.run(openConversation(job,{doc:f.doc,timeout:2000}));
  const snapshot=await f.run(prepare(job,{doc:f.doc,fillMessage:true,timeout:2000}));
  const evidence=await f.run(sendPrepared({...job,message:snapshot.message},snapshot,{doc:f.doc,timeout:1000}));
  assert.equal(evidence.confirmed,true);assert.equal(f.clicks(),1);assert.equal(f.wrongClicks(),0);
 });
}
test('no result keeps a valid number pending with a search-specific error',async t=>{
 const f=fixture(t,{empty:true});await assert.rejects(f.run(openConversation({phone,message:'Oi'},{doc:f.doc,timeout:500})),e=>e.code==='SEARCH_RESULT_NOT_FOUND');assert.equal(f.clicks(),0);
});
test('a different returned number cannot be selected as a single-name fallback',async t=>{
 const f=fixture(t,{wrong:true});await assert.rejects(f.run(openConversation({phone,message:'Oi'},{doc:f.doc,timeout:500})));assert.equal(f.selected(),0);assert.equal(f.clicks(),0);
});
