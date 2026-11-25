import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parsePage,safeUrl} from '../lib/store-parser.ts';
import {refreshDevice,priceObservation,readDevice,saveDevice} from '../lib/device-catalog.ts';
const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const original=parsePage('iPeople',fixture('ipeople_product.html'),'https://ipeople.ua/products/test').record;
const i={...original,model:'17'};
const j=parsePage('Jabko',fixture('jabko18_product.html'),'https://jabko.ua/product/apple-iphone-18-pro-256gb-burgundy').record;
test('iPeople verified product and preorder',()=>{assert.ok(i);assert.equal(i.price,'35799');assert.equal(i.sim,'physical');assert.equal(i.status,'ok');const pre=parsePage('iPeople',fixture('ipeople_product.html').replaceAll('В наявності','Під замовлення'),i.url).record;assert.equal(pre.status,'preorder');assert.equal(pre.price,'35799');});
test('Jabko confirms low stock and standalone new condition schema',()=>{const low=parsePage('Jabko',fixture('jabko_low_stock.html'),'https://jabko.ua/iphone/apple-iphone-16/apple-iphone-16-128gb-white').record;assert.equal(low.price,'40399');assert.equal(low.status,'ok');const p=parsePage('Jabko',fixture('jabko18_product.html'),'https://jabko.ua/product/apple-iphone-18-pro-256gb-burgundy').record;assert.equal(p.price,'79999');assert.equal(p.model,'18 Pro');assert.equal(p.sim,'physical');});
test('cannot reuse price when SIM or memory changes',()=>{const p=priceObservation(i,{...i,sim:'esim',price:'100000'});assert.equal(p.status,'error');assert.equal(p.price,i.price);assert.equal(p.sim,'physical');assert.equal(priceObservation(i,{...i,price:null,status:'error'}).last_success_at,i.checked_at);});
test('no invented SIM, condition or color',()=>{assert.equal(parsePage('iPeople',fixture('ipeople_product.html').replaceAll('nano-SIM','unknown').replaceAll('SIM + eSIM','unknown'),i.url).record,null);assert.equal(parsePage('Jabko',fixture('jabko18_product.html').replaceAll('Apple iPhone 18 Pro','Apple iPhone 18 Pro (Як Новий)'),'https://jabko.ua/product/test').record,null);});
test('URL whitelist rejects credentials, port and external domains',()=>{for(const u of ['http://ipeople.ua/a','https://ipeople.ua.evil/a','https://x:y@ipeople.ua/a','https://ipeople.ua:8080/a','https://127.0.0.1/'])assert.throws(()=>safeUrl(u,'iPeople'));});
test('device storage isolates accounts and resumes saved catalog',()=>{const map=new Map();global.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};saveDevice('1',{catalog:{products:[i],stores:{}},rate:'45',job:null});assert.equal(readDevice('1').rate,'45');assert.equal(readDevice('2'),null);map.set('iphone-catalog:v2:1','bad');assert.equal(readDevice('1'),null);});
test('prices visit only saved URLs and preserve identity on mismatch',async()=>{const visited=[],updates=[];await refreshDevice('prices',{products:[i],stores:{}},async(store,url)=>{visited.push(url);return {record:{...i,model:'WRONG',price:'100000'}};},(c,job)=>updates.push({c,job}),new AbortController().signal,'new',['iPeople']);assert.deepEqual(visited,[i.url]);const last=updates.at(-1);assert.equal(last.c.products[0].model,i.model);assert.equal(last.c.products[0].price,i.price);assert.equal(last.job.status,'partial');});
test('full catalog follows pages and SIM variants without transferring prices',async()=>{const p={...i,url:'https://ipeople.ua/new',price:'40000'},variant={...p,store:'Jabko',url:'https://jabko.ua/new',sim:'esim'};const reads=[];const read=async(store,url)=>{reads.push(url);if(url.endsWith('/iphone/'))return {catalogPage:true,urls:[store==='iPeople'?p.url:variant.url],next:null};return {record:store==='iPeople'?p:variant,variants:[]};};const result=await refreshDevice('catalog',{products:[i],stores:{}},read,()=>{},new AbortController().signal,'new',['iPeople','Jabko']);assert.ok(reads.includes('https://ipeople.ua/apple-ua/iphone/'));assert.equal(result.catalog.products.find(v=>v.url===i.url).status,'unavailable');assert.equal(result.catalog.products.find(v=>v.url===variant.url).sim,'esim');});
test('abort stops further requests',async()=>{const c=new AbortController();c.abort();let calls=0;await assert.rejects(refreshDevice('prices',{products:[i],stores:{}},async()=>{calls++;},()=>{},c.signal),/остановлено/);assert.equal(calls,0);});
test('blocked store keeps unchecked prices as historical and ends the loop',async()=>{const second={...i,url:'https://ipeople.ua/second'},third={...i,url:'https://ipeople.ua/third'};let calls=0;const result=await refreshDevice('prices',{products:[i,second,third],stores:{}},async()=>{calls++;throw new Error('http_403');},()=>{},new AbortController().signal,'new',['iPeople']);assert.equal(calls,1);assert.ok(result.catalog.products.every(p=>p.price===i.price&&p.status==='error'));assert.equal(result.job.status,'partial');});

test('independent stores overlap, each store stays sequential and progress never reverses',async()=>{
 const products=[{...i,url:'https://ipeople.ua/first'},{...i,url:'https://ipeople.ua/second'}, {...j,url:'https://jabko.ua/first'},{...j,url:'https://jabko.ua/second'}];
 const active=new Set(),started=new Set(),snapshots=[];let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const read=async(store,url)=>{
  assert.equal(active.has(store),false,'only one request per store');active.add(store);started.add(store);
  if(started.size===2)release();
  await gate;active.delete(store);
  return {record:{...products.find(p=>p.url===url),price:'50000'}};
 };
 const result=await refreshDevice('prices',{products,stores:{}},read,(catalog,job)=>snapshots.push({catalog,job}),new AbortController().signal,'new',['iPeople','Jabko','iPeople']);
 assert.equal(result.job.status,'succeeded');assert.equal(started.size,2);
 assert.ok(result.catalog.products.every(p=>p.price==='50000'));
 assert.ok(snapshots.every((s,n)=>n===0||s.job.progress>=snapshots[n-1].job.progress));
 assert.equal(snapshots.at(-1).job.progress,100);
 assert.notEqual(snapshots[0].catalog.stores,result.catalog.stores);
});

test('a blocked store does not stop another store',async()=>{
 const result=await refreshDevice('prices',{products:[i,j],stores:{}},async(store)=>{
  if(store==='iPeople')throw new Error('source_challenge');return {record:{...j,price:'51000'}};
 },()=>{},new AbortController().signal,'new',['iPeople','Jabko']);
 assert.equal(result.job.status,'partial');assert.equal(result.catalog.stores.Jabko.status,'ok');
 assert.equal(result.catalog.products.find(p=>p.store==='Jabko').price,'51000');
 assert.equal(result.catalog.products.find(p=>p.store==='iPeople').price,i.price);
});

test('cancellation waits for active stores and never reports success or writes after rejection',async()=>{
 const controller=new AbortController();let writes=0,release,started;
 const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{started=resolve;});
 const task=refreshDevice('prices',{products:[i,j],stores:{}},async(store)=>{
  if(store==='iPeople'){await gate;return {record:i};}started();controller.abort();return {record:j};
 },()=>{writes++;},controller.signal,'new',['iPeople','Jabko']);
 await ready;let settled=false;task.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
 release();await assert.rejects(task,/остановлено/);const previous=writes;await Promise.resolve();assert.equal(writes,previous);
});

test('duplicate saved URLs are read once and empty selections complete',async()=>{
 let calls=0;const read=async()=>{calls++;return {record:i};};
 await refreshDevice('prices',{products:[i,{...i}],stores:{}},read,()=>{},new AbortController().signal,'new',['iPeople']);assert.equal(calls,1);
 const empty=await refreshDevice('prices',{products:[],stores:{}},read,()=>{},new AbortController().signal,'new',[]);assert.equal(empty.job.status,'succeeded');assert.equal(empty.job.progress,100);
});
