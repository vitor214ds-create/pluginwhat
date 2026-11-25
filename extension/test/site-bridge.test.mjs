import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSiteSender, decodeSiteCampaign, siteStatus } from '../site-bridge.js';
import { createCampaign } from '../core.js';
const origin = 'https://zsites.lovable.app';
const input = () => ({ requestId: crypto.randomUUID(), messages: ['Olá (empresa) em (cidade): (previa)', 'Bom dia (empresa)', 'Oi (nome)! (previa)'], intervalSeconds: 120,
 recipients: Array.from({length:4},(_,i)=>({placeId:'p'+i,phone:'551191234567'+i,name:'Empresa $& '+i,city:'São Paulo',document:{id:crypto.randomUUID(),name:'Empresa-'+i+'-previa.html',mime:'text/html',size:100,sha256:String(i+1).repeat(64)}})) });
test('only the two exact site origins and localhost can communicate; lookalikes and subframes are rejected',()=>{
 for(const url of [origin,'https://site-scout-ai-90.lovable.app','http://localhost:5173'])assert.equal(requireSiteSender({url:url+'/search',origin:url}),url);
 for(const sender of [{url:origin+'.evil.test/search'},{url:origin,origin:'https://evil.test'},{url:origin,frameId:1},{url:'chrome-extension://fake/page'},{url:'https://other.lovable.app/search'}])assert.throws(()=>requireSiteSender(sender),/Origem/);
});
test('four recipients keep rotation 1/2/3/1 while each has its own HTML document and no preview URL',()=>{
 const source=input(),decoded=decodeSiteCampaign(source,origin),state=createCampaign(decoded.config,7);
 assert.deepEqual(state.queue.map(r=>r.template),[0,1,2,0]);
 assert.ok(state.queue[0].message.includes('Empresa $& 0'));
 assert.equal(state.queue[1].message,'Bom dia Empresa $& 1');
 assert.equal(state.queue[2].message,'Oi (nome)!');
 assert.ok(!JSON.stringify(state).includes('http'));
 decoded.recipients.forEach((row,i)=>assert.equal(row.attachment.sha256,source.recipients[i].document.sha256));
});
test('HTML metadata rejects missing documents, unsafe names, incorrect MIME, size and checksum',()=>{
 for(const mutate of [r=>delete r.document,r=>r.document.name='../file.html',r=>r.document.name='file.exe',r=>r.document.mime='application/javascript',r=>r.document.size=50_000_001,r=>r.document.sha256='bad']){
  const source=input();mutate(source.recipients[0]);assert.throws(()=>decodeSiteCampaign(source,origin));
 }
});
test('old preview markers and sharing URLs are removed without appending a link; duplicates are rejected',()=>{
 let source=input();source.messages[0]='Bom dia (empresa) (previa) '+origin+'/p/'+'a'.repeat(64);
 assert.equal(decodeSiteCampaign(source,origin).config.contactMessages[0],'Bom dia Empresa $& 0');
 source=input();source.recipients[1].phone=source.recipients[0].phone;assert.throws(()=>decodeSiteCampaign(source,origin));
 source=input();source.recipients[1].placeId=source.recipients[0].placeId;assert.throws(()=>decodeSiteCampaign(source,origin));
 source=input();source.messages[0]='(previa)';assert.throws(()=>decodeSiteCampaign(source,origin));
});
test('public status returns document metadata without HTML, job tokens, connection identity or URL',()=>{
 const state=createCampaign(decodeSiteCampaign(input(),origin).config,7);state.source={clientId:'secret',origin};state.job={id:'secret-job'};
 const serialized=JSON.stringify(siteStatus(state));assert.ok(!serialized.includes('secret'));assert.ok(!serialized.includes('http'));assert.ok(!serialized.includes('<html'));
});
