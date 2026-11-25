import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from '../../qa/node_modules/fake-indexeddb/build/esm/index.js';
import { createDocumentStore, DOCUMENT_CHUNK_BYTES, bytesToBase64, sha256 } from '../documents.js';
async function sample(length=100){const bytes=new Uint8Array(length).fill(65);return {bytes,document:{id:crypto.randomUUID(),name:'Empresa-previa.html',mime:'text/html',size:length,sha256:await sha256(bytes)}};}
test('a chunked HTML survives worker recreation with exact bytes and is isolated by owner',async()=>{
 const factory=new IDBFactory(),store=createDocumentStore(()=>factory),{bytes,document}=await sample(DOCUMENT_CHUNK_BYTES+17),owner='site|owner';
 await store.begin(owner,document);await store.append(owner,document.id,0,bytesToBase64(bytes.subarray(0,DOCUMENT_CHUNK_BYTES)));
 const restarted=createDocumentStore(()=>factory);assert.equal((await restarted.begin(owner,document)).nextIndex,1);
 await restarted.append(owner,document.id,1,bytesToBase64(bytes.subarray(DOCUMENT_CHUNK_BYTES)));await restarted.finish(owner,document.id);
 assert.equal((await restarted.descriptor(owner,document.id)).sha256,document.sha256);
 assert.equal(await restarted.chunk(owner,document.id,1),bytesToBase64(bytes.subarray(DOCUMENT_CHUNK_BYTES)));
 await assert.rejects(restarted.descriptor('other-owner',document.id));await assert.rejects(restarted.chunk('other-owner',document.id,0));
 await restarted.release(owner,[document.id]);await assert.rejects(restarted.descriptor(owner,document.id));
});
test('missing, reordered, changed duplicate and corrupted chunks cannot be finalized',async()=>{
 const store=createDocumentStore(()=>factory),factory=new IDBFactory(),{bytes,document}=await sample(DOCUMENT_CHUNK_BYTES+1),owner='owner';
 await store.begin(owner,document);await assert.rejects(store.finish(owner,document.id),/incompleta/);
 await assert.rejects(store.append(owner,document.id,1,bytesToBase64(bytes.subarray(DOCUMENT_CHUNK_BYTES))),/ordem/);
 const first=bytesToBase64(bytes.subarray(0,DOCUMENT_CHUNK_BYTES));await store.append(owner,document.id,0,first);await store.append(owner,document.id,0,first);
 await assert.rejects(store.append(owner,document.id,0,bytesToBase64(new Uint8Array(DOCUMENT_CHUNK_BYTES))),/diferentes/);
 await store.append(owner,document.id,1,bytesToBase64(new Uint8Array([0])));await assert.rejects(store.finish(owner,document.id),/não corresponde/);
});
test('storage reserves a bounded total and releases documents after completion',async()=>{
 const factory=new IDBFactory(),store=createDocumentStore(()=>factory),ids=[];
 for(let i=0;i<5;i++){const document={id:crypto.randomUUID(),name:'file.html',mime:'text/html',size:50_000_000,sha256:'a'.repeat(64)};ids.push(document.id);await store.begin('owner',document);}
 await assert.rejects(store.begin('owner',{id:crypto.randomUUID(),name:'file.html',mime:'text/html',size:50_000_000,sha256:'a'.repeat(64)}),/256 MB/);
 await store.release('owner',ids);await store.begin('owner',{id:crypto.randomUUID(),name:'file.html',mime:'text/html',size:50_000_000,sha256:'a'.repeat(64)});
});
