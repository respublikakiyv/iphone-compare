import test from 'node:test';import assert from 'node:assert/strict';import {readDevice,saveDevice} from '../lib/device-catalog.ts';
const p={store:'iPeople',url:'https://ipeople.ua/products/a',model:'17',storage:'256GB',sim:'physical',color:'Lavender',edition:'Standard',price:'45000',status:'ok',checked_at:'2026-10-19T09:00:00Z',sku:null,full_title:'Apple iPhone 17 256GB Lavender'};
test('compact cache round-trips a large catalog including optional and null fields',()=>{
 const map=new Map();global.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const state={catalog:{products:Array.from({length:5000},(_,i)=>({...p,url:p.url+i,...(i%2?{category:'iphone',last_success_at:p.checked_at}:{price:null})})),stores:{iPeople:{status:'ok'}}},rate:'45.2',job:null,extraStores:['Comfy']};
 assert.equal(saveDevice('compact-large',state),'full');assert.deepEqual(readDevice('compact-large'),state);assert.ok(map.get('iphone-catalog:v2:compact-large').length<JSON.stringify(state).length);assert.equal(readDevice('another-account'),null);
});
test('full quota keeps the app usable and persists small personal preferences',()=>{
 const map=new Map();global.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>{if(v.length>250)throw new DOMException('quota','QuotaExceededError');map.set(k,v);}};
 const state={catalog:{products:[p],stores:{}},rate:'45.2',job:null,extraStores:['Comfy']};assert.equal(saveDevice('quota-full',state),'preferences');assert.deepEqual(readDevice('quota-full'),state);const saved=JSON.parse(map.get('iphone-catalog:v2:quota-full'));assert.deepEqual(saved.extraStores,['Comfy']);assert.deepEqual(saved.catalog.products,[]);
});
test('disabled WebView storage does not throw or discard the working in-memory catalog',()=>{
 global.localStorage={getItem:()=>{throw new DOMException('disabled','SecurityError');},setItem:()=>{throw new DOMException('disabled','SecurityError');}};const state={catalog:{products:[p],stores:{}},rate:'45.2',job:null};assert.equal(saveDevice('storage-disabled',state),'memory');assert.deepEqual(readDevice('storage-disabled'),state);
});
