import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSiteSender, decodeSiteCampaign, siteStatus } from '../site-bridge.js';
import { createCampaign, validateConfig } from '../core.js';
const origin = 'https://site-scout-ai-90.lovable.app';
const input = () => ({ requestId: crypto.randomUUID(), messages: ['Olá (empresa) em (cidade): (previa)', 'Bom dia (empresa)', 'Oi (nome)! (previa)'], intervalSeconds: 120,
  recipients: Array.from({length:4}, (_,i) => ({ placeId: 'p'+i, phone:'551191234567'+i, name:'Empresa $& '+i, city:'São Paulo', previewUrl:origin+'/p/'+String(i+1).repeat(64), expiresAt:new Date(Date.now()+86400000).toISOString() })) });

test('origin validation rejects lookalike domains, mismatched origins, subframes and extension callers', () => {
  assert.equal(requireSiteSender({url:origin+'/search',origin}),origin);
  assert.equal(requireSiteSender({url:'http://localhost:5173/search'}),'http://localhost:5173');
  for(const sender of [{url:origin+'.evil.test/search'}, {url:origin+'/search',origin:'https://evil.test'}, {url:origin+'/search',frameId:1}, {url:'chrome-extension://fake/page'}, {url:'https://other.lovable.app/search'}]) assert.throws(()=>requireSiteSender(sender),/Origem/);
});
test('four recipients get 1,2,3,1 with unique links and literal placeholder replacements', () => {
  const source=input(), decoded=decodeSiteCampaign(source,origin), state=createCampaign(decoded.config,7);
  assert.deepEqual(state.queue.map(r=>r.template),[0,1,2,0]);
  state.queue.forEach((row,index)=>{
    assert.ok(row.message.includes(source.recipients[index].previewUrl));
    source.recipients.forEach((other,j)=>{ if(index!==j) assert.ok(!row.message.includes(other.previewUrl)); });
  });
  assert.ok(state.queue[0].message.includes('Empresa $& 0'));
  assert.ok(state.queue[2].message.includes('(nome)'));
  assert.ok(state.queue[1].message.endsWith(source.recipients[1].previewUrl));
});
test('foreign, malformed, expired and too-short-lived preview URLs are rejected before starting', () => {
  for(const mutate of [r=>r.previewUrl='https://evil.test/p/'+'a'.repeat(64),r=>r.previewUrl=origin+'/dashboard',r=>r.previewUrl+='?session=secret',r=>r.expiresAt='2000-01-01',r=>r.expiresAt=new Date(Date.now()+120000).toISOString()]) {
    const source=input();mutate(source.recipients[0]);assert.throws(()=>decodeSiteCampaign(source,origin));
  }
});
test('duplicate phones, duplicate places and oversized final messages cannot enter the queue', () => {
  let source=input();source.recipients[1].phone=source.recipients[0].phone;assert.throws(()=>decodeSiteCampaign(source,origin));
  source=input();source.recipients[1].placeId=source.recipients[0].placeId;assert.throws(()=>decodeSiteCampaign(source,origin));
  source=input();source.messages[0]='a'.repeat(2990);assert.throws(()=>decodeSiteCampaign(source,origin),/3.000/);
  assert.throws(()=>validateConfig({...decodeSiteCampaign(input(),origin).config,contactMessages:['one']}));
});
test('public status excludes message bodies, internal job tokens and local connection identity', () => {
  const state=createCampaign(decodeSiteCampaign(input(),origin).config,7);state.source={clientId:'secret',origin};state.job={id:'secret-job'};
  const serialized=JSON.stringify(siteStatus(state));assert.ok(!serialized.includes('secret'));assert.ok(!serialized.includes('message'));
});
