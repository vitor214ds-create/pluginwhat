import test from 'node:test';
import assert from 'node:assert/strict';
import { readJobDocument } from '../content-main.js';
import { DOCUMENT_CHUNK_BYTES, bytesToBase64, sha256 } from '../documents.js';
test('content runner reconstructs exactly the staged document across chunk boundaries',async()=>{
 const bytes=new TextEncoder().encode('<html>'+ 'á'.repeat(DOCUMENT_CHUNK_BYTES)+'</html>');
 const attachment={id:crypto.randomUUID(),name:'Empresa-previa.html',mime:'text/html',size:bytes.length,sha256:await sha256(bytes)},calls=[];
 const api={runtime:{sendMessage:async request=>{calls.push(request);return {ok:true,base64:bytesToBase64(bytes.subarray(request.index*DOCUMENT_CHUNK_BYTES,(request.index+1)*DOCUMENT_CHUNK_BYTES))};}}};
 const file=await readJobDocument({id:'job',attachment},api,{defaultView:{File}});
 assert.equal(file.name,attachment.name);assert.equal(file.type,'text/html');assert.equal(await file.text(),new TextDecoder().decode(bytes));
 assert.equal(calls.length,Math.ceil(bytes.length/DOCUMENT_CHUNK_BYTES));assert.ok(calls.every(r=>r.jobId==='job'&&r.type==='GET_DOCUMENT_CHUNK'));
});
test('content runner refuses corrupted or cancelled document transfer before any attachment',async()=>{
 const bytes=new Uint8Array([1,2,3]),attachment={name:'Empresa-previa.html',mime:'text/html',size:3,sha256:await sha256(bytes)};
 const api={runtime:{sendMessage:async()=>({ok:true,base64:bytesToBase64(new Uint8Array([0,0,0]))})}};
 await assert.rejects(readJobDocument({id:'job',attachment},api,{defaultView:{File}}),/não corresponde/);
 await assert.rejects(readJobDocument({id:'job',attachment},api,{defaultView:{File}},()=>true),/cancelada/);
});
