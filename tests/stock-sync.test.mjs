import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
register('./cloudflare-test-loader.mjs',import.meta.url);
const sql=new DatabaseSync(':memory:');for(const n of ['0000_clumsy_blockbuster.sql','0001_serious_arclight.sql'])sql.exec(fs.readFileSync(new URL('../drizzle/'+n,import.meta.url),'utf8'));
function prepare(q){const stmt=sql.prepare(q);let v=[];return {bind(...x){v=x;return this;},async first(){return stmt.get(...v)||null;},async all(){return {results:stmt.all(...v)};},async run(){return this.exec();},exec(){return {meta:{changes:Number(stmt.run(...v).changes)}};}};}
globalThis.__testCloudflareEnv={DB:{prepare,async batch(a){sql.exec('BEGIN');try{const r=a.map(s=>s.exec());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}},MOYSKLAD_TOKEN:'test',MOYSKLAD_WEBHOOK_SECRET:'x'.repeat(64)};
const {refreshStockCards,syncStock,putStockSnapshot,stockSnapshot}=await import('../lib/stock-sync.ts');const {readStockBase,patchStockBase}=await import('../lib/stock-base.ts');const {queueStockEvent}=await import('../lib/stock-webhook.ts');const {GET}=await import('../app/api/stock/route.ts');const {stockProductKey,stockWarehouses}=await import('../lib/warehouse-stock.ts');
const id='11111111-1111-1111-1111-111111111111',p={store:'iPeople',url:'https://ipeople.ua/used17',model:'17',storage:'256GB',sim:'physical',color:'Black',edition:'Used',price:'40000',status:'ok',checked_at:'2026-10-19T00:00:00Z'},key=stockProductKey(p),other=key+'other',href='https://api.moysklad.ru/api/remap/1.2/entity/product/'+id;
async function reset(){sql.exec('DELETE FROM snapshots;DELETE FROM cloud_refresh');await putStockSnapshot('catalog',{products:[p],stores:{}});await putStockSnapshot('used-stock-base-v1',{values:{[key]:[3,2,1],[other]:[7,0,0]},targets:{[key]:[href]},checkedAt:[]});}
async function fetchWith(fn,run){const f=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=f;}}
test('cached entry performs zero provider requests and omits internal targets',async()=>{await reset();await fetchWith(()=>assert.fail('vendor fetch on entry'),async()=>{const r=await(await GET(new Request('https://example.test/api/stock?scope=used'))).json();assert.deepEqual(r.values[key],[3,2,1]);assert.equal(r.targets,undefined);});});
test('card refresh uses one provider call and preserves other cards and prices',async()=>{await reset();let calls=0;await fetchWith(async url=>{calls++;assert.match(url,/bystore\/current/);return Response.json([{assortmentId:id,storeId:stockWarehouses[0].id,stock:0}]);},()=>refreshStockCards([p],true));assert.equal(calls,1);const base=await readStockBase();assert.deepEqual(base.values[key],[0,0,0]);assert.deepEqual(base.values[other],[7,0,0]);assert.equal((await stockSnapshot('catalog')).products[0].price,'40000');});
test('failed provider preserves saved values and does not advance synchronization cursor',async()=>{await reset();await fetchWith(async()=>new Response('',{status:403}),async()=>{const r=await syncStock('used');assert.equal(r.partial,true);assert.equal(await stockSnapshot('stock-cursor:used'),null);assert.deepEqual((await readStockBase()).values[key],[3,2,1]);});});
test('newer persisted quantities and independent cards survive late responses',async()=>{await reset();await patchStockBase({[key]:[0,0,0]},{[key]:[href]},true,'2026-10-20T00:00:00Z');await patchStockBase({[key]:[9,9,9],[other]:[1,0,0]},{[key]:[href]},true,'2026-10-19T00:00:00Z');const b=await readStockBase();assert.deepEqual(b.values[key],[0,0,0]);assert.deepEqual(b.values[other],[1,0,0]);});
test('webhook validates secret/account, ignores untrusted report URL and deduplicates durable events',async()=>{await reset();await putStockSnapshot('stock-webhook-config',{accountId:'account'});const request=(secret='x'.repeat(64),account='account')=>new Request('https://example.test/api/stock/webhook?key='+secret+'&requestId='+id,{method:'POST',body:JSON.stringify({accountId:account,stockType:'stock',reportType:'bystore',reportUrl:'https://evil.test/secrets'})});await fetchWith(()=>assert.fail('callback must ACK before network work'),async()=>{assert.equal(await queueStockEvent(request('bad')),403);assert.equal(await queueStockEvent(request(undefined,'wrong')),400);assert.equal(await queueStockEvent(request()),204);assert.equal(await queueStockEvent(request()),204);assert.equal(sql.prepare("SELECT count(*) n FROM snapshots WHERE id LIKE 'stock-event:%'").get().n,1);});});
test('global refresh switches to an overlapping delta after a successful full check',async()=>{await reset();const calls=[];await fetchWith(async url=>{calls.push(new URL(url));return Response.json(calls.length===1?[{assortmentId:id,storeId:stockWarehouses[0].id,stock:1}]:[]);},async()=>{assert.equal((await syncStock('used')).partial,false);assert.equal((await syncStock('used')).mode,'changes');});assert.equal(calls.length,2);assert.equal(calls[0].searchParams.has('changedSince'),false);assert.equal(calls[1].searchParams.has('changedSince'),true);assert.deepEqual((await readStockBase()).values[key],[1,0,0]);});
test('large catalog writes remain below hosted per-request SQL query limits',async()=>{await reset();const old=globalThis.__testCloudflareEnv.DB.prepare;let queries=0;globalThis.__testCloudflareEnv.DB.prepare=(q)=>{queries++;return old(q);};try{const values=Object.fromEntries(Array.from({length:5000},(_,i)=>['card'+i,[i,0,0]]));await patchStockBase(values,{},false,'2026-10-19T00:00:00Z');assert.ok(queries<100,'5000 cards must use fewer than 100 SQL calls');assert.equal((await readStockBase(false)).values.card4999[0],4999);}finally{globalThis.__testCloudflareEnv.DB.prepare=old;}});
test('one warehouse-wide delta updates sold-out cards and ignores unrelated assortment IDs',async()=>{await reset();let calls=0;await fetchWith(async url=>{calls++;const q=new URL(url).searchParams;assert.equal(q.has('changedSince')&&q.has('include'),false);return Response.json(calls===1?[{assortmentId:id,storeId:stockWarehouses[0].id,stock:2}]:[{assortmentId:id,storeId:stockWarehouses[0].id,stock:0},{assortmentId:'unrelated',storeId:stockWarehouses[1].id,stock:100}]);},async()=>{await syncStock('used');const r=await syncStock('used');assert.equal(r.partial,false);assert.equal(r.requests,1);});assert.equal(calls,2);assert.deepEqual((await readStockBase()).values[key],[0,0,0]);});

test('paused integration blocks every outbound entry point and preserves cached stock',async()=>{
 await reset();globalThis.__testCloudflareEnv.MOYSKLAD_DISABLED='true';
 try{await fetchWith(()=>assert.fail('MoySklad must remain disconnected'),async()=>{
  const {scheduledStockSync,drainStockEvents}=await import('../lib/stock-webhook.ts');
  const {stockRequest}=await import('../lib/moysklad.ts');
  const {POST:setup}=await import('../app/api/stock/setup/route.ts');
  const {POST}=await import('../app/api/stock/route.ts');
  assert.equal((await syncStock()).paused,true);assert.equal((await scheduledStockSync()).paused,true);assert.equal((await drainStockEvents()).paused,true);
  await assert.rejects(()=>refreshStockCards([p],true),/отключён/);await assert.rejects(()=>stockRequest('https://api.moysklad.ru/','test'),/отключён/);
  const cached=await (await GET(new Request('https://example.test/api/stock?scope=used'))).json();assert.equal(cached.integrationPaused,true);assert.deepEqual(cached.values[key],[3,2,1]);
  assert.equal((await POST(new Request('https://example.test/api/stock',{method:'POST',body:JSON.stringify({all:true})}))).status,409);
  assert.equal((await setup(new Request('https://example.test/api/stock/setup?key='+ 'x'.repeat(64),{method:'POST',body:JSON.stringify({action:'register'})}))).status,409);
 });}finally{delete globalThis.__testCloudflareEnv.MOYSKLAD_DISABLED;}
});

test('manual card action does not enable background or direct bulk sync',async()=>{
 await reset();globalThis.__testCloudflareEnv.MOYSKLAD_MODE='manual';
 try{
  const {POST}=await import('../app/api/stock/route.ts');
  const {scheduledStockSync,drainStockEvents}=await import('../lib/stock-webhook.ts');
  const {stockRequest}=await import('../lib/moysklad.ts');
  let calls=0;
  await fetchWith(async url=>{calls++;assert.match(url,/bystore\/current/);assert.match(decodeURIComponent(url),new RegExp(id));assert.equal((await scheduledStockSync()).paused,true);return Response.json([{assortmentId:id,storeId:stockWarehouses[0].id,stock:1}]);},async()=>{
   assert.equal((await syncStock()).paused,true);assert.equal((await scheduledStockSync()).paused,true);assert.equal((await drainStockEvents()).paused,true);
   await assert.rejects(()=>stockRequest('https://api.moysklad.ru/','test'),/только кнопкой/);
   const read=await (await GET(new Request('https://example.test/api/stock?scope=used'))).json();assert.equal(read.manualOnly,true);assert.equal(read.integrationPaused,false);assert.equal(calls,0);
   const post=body=>POST(new Request('https://example.test/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));

   assert.equal((await post({targets:[{store:'iPeople',url:'https://ipeople.ua/unknown'}],scope:'used'})).status,400);assert.equal(calls,0);
   const result=await post({targets:[{store:p.store,url:p.url}],scope:'used'});assert.equal(result.status,200);assert.equal(calls,1);
   const base=await readStockBase();assert.deepEqual(base.values[key],[1,0,0]);assert.deepEqual(base.values[other],[7,0,0]);
   await assert.rejects(()=>stockRequest('https://api.moysklad.ru/','test'),/только кнопкой/);assert.equal(calls,1);
  });
 }finally{delete globalThis.__testCloudflareEnv.MOYSKLAD_MODE;}
});

test('manual verification timestamps survive reload without advancing other cards',async()=>{
 await reset();const earlier='2026-10-19T10:00:00Z';await patchStockBase({[key]:[3,2,1],[other]:[7,0,0]},{[key]:[href]},true,earlier,{[key]:[earlier,earlier,earlier],[other]:[earlier,earlier,earlier]});
 await fetchWith(async()=>Response.json([{assortmentId:id,storeId:stockWarehouses[0].id,stock:0}]),()=>refreshStockCards([p],true));const base=await readStockBase();assert.deepEqual(base.values[key],[0,0,0]);assert.equal(base.verifiedAt[key].every(date=>date&&date>earlier),true);assert.deepEqual(base.verifiedAt[other],[earlier,earlier,earlier]);
 const response=await(await GET(new Request('https://example.test/api/stock?scope=used'))).json();assert.deepEqual(response.verifiedAt[key],base.verifiedAt[key]);
});

 test('manual all-stock button refreshes both scopes without enabling scheduled work',async()=>{
 await reset();const fresh={...p,url:'https://ipeople.ua/new17',edition:'Standard'},freshKey=stockProductKey(fresh);await putStockSnapshot('catalog',{products:[p,fresh],stores:{}});await patchStockBase({[freshKey]:[3,2,1]},{[freshKey]:[href]},false,'2026-10-19T00:00:00Z');globalThis.__testCloudflareEnv.MOYSKLAD_MODE='manual';
 try{const {POST}=await import('../app/api/stock/route.ts');let calls=0;await fetchWith(async url=>{calls++;return Response.json([{assortmentId:id,storeId:stockWarehouses[0].id,stock:0}]);},async()=>{
 const request=()=>new Request('https://example.test/api/stock',{method:'POST',body:JSON.stringify({all:true})});
 assert.equal((await syncStock()).paused,true);assert.equal(calls,0);
 let result=await(await POST(request())).json();assert.equal(result.partial,false);assert.equal(result.mode,'full');assert.equal(calls,2);assert.deepEqual((await readStockBase(false)).values[freshKey],[0,0,0]);assert.deepEqual((await readStockBase()).values[key],[0,0,0]);assert.ok((await readStockBase()).verifiedAt[key].every(Boolean));
 result=await(await POST(request())).json();assert.equal(result.mode,'full');assert.equal(calls,4);assert.equal((await syncStock()).paused,true);
 globalThis.__testCloudflareEnv.MOYSKLAD_DISABLED='true';assert.equal((await POST(request())).status,409);assert.equal(calls,4);
 });}finally{delete globalThis.__testCloudflareEnv.MOYSKLAD_MODE;delete globalThis.__testCloudflareEnv.MOYSKLAD_DISABLED;}
 });

test('weighted request policy covers user-token changes and heavier reports',async()=>{
 const {stockRequestWeight,stockRetryDelay}=await import('../lib/stock-rate-limit.ts');const root='https://api.moysklad.ru/api/remap/1.2/';
 assert.equal(stockRequestWeight(root+'report/stock/bystore/current',Date.parse('2026-10-21')),3);assert.equal(stockRequestWeight(root+'report/stock/bystore/current',Date.parse('2026-12-02')),4);assert.equal(stockRequestWeight(root+'report/stock/bystore'),5);assert.equal(stockRetryDelay(new Headers({'X-Lognex-Retry-After':'3000'})),3000);
});
test('simultaneous sellers share one provider delta; unchanged reads omit cached payload',async()=>{
 await reset();globalThis.__testCloudflareEnv.MOYSKLAD_MODE='realtime';
 try{const at=new Date(Date.now()-120000).toISOString();await putStockSnapshot('stock-cursor:all',{at,fullAt:at,catalogAt:undefined});
 const {reconcileOpenStock}=await import('../lib/stock-webhook.ts');const {runWithBackground}=await import('../lib/background.ts');
 let calls=0;await fetchWith(async()=>{calls++;return Response.json([]);},async()=>{
 await Promise.all(Array.from({length:8},()=>reconcileOpenStock()));assert.equal(calls,1);
 const pending=[];const get=url=>runWithBackground({waitUntil:p=>pending.push(p)},()=>GET(new Request(url)));
 const first=await(await get('https://example.test/api/stock?scope=used')).json();assert.ok(first.version);assert.ok(first.syncedAt);
 const second=await(await get('https://example.test/api/stock?scope=used&version='+encodeURIComponent(first.version))).json();assert.equal(second.unchanged,true);assert.equal(second.values,undefined);await Promise.all(pending);assert.equal(calls,1);
 });}finally{delete globalThis.__testCloudflareEnv.MOYSKLAD_MODE;}
});
test('webhook registration re-enables this site hook and reuses its saved identity',async()=>{
 await reset();const {ensureStockWebhook}=await import('../lib/stock-webhook.ts');let calls=0;const secret=globalThis.__testCloudflareEnv.MOYSKLAD_WEBHOOK_SECRET;
 await fetchWith(async(url,options)=>{calls++;if(options.method==='PUT')return Response.json({id,accountId:id,enabled:true});return Response.json({rows:[{id,accountId:id,enabled:false,reportType:'bystore',stockType:'stock',url:'https://example.test/api/stock/webhook?key='+secret}]});},async()=>{
 assert.equal((await ensureStockWebhook('https://example.test')).enabled,true);assert.equal(calls,2);assert.equal((await ensureStockWebhook('https://example.test')).registered,true);assert.equal(calls,2);
 });
});

test('provider requests from concurrent cards respect the shared weighted spacing',async()=>{
 await reset();const times=[];const {stockRequest}=await import('../lib/moysklad.ts');await fetchWith(async()=>{times.push(Date.now());return Response.json([]);},()=>Promise.all(Array.from({length:3},()=>stockRequest('https://api.moysklad.ru/api/remap/1.2/report/stock/bystore/current','test'))));times.sort();assert.equal(times.length,3);assert.ok(times[1]-times[0]>=140);assert.ok(times[2]-times[1]>=140);
});
test('failed background verification is cooled down and never advances freshness',async()=>{
 await reset();const at=new Date(Date.now()-120000).toISOString();await putStockSnapshot('stock-cursor:all',{at,fullAt:at});let calls=0;const {reconcileOpenStock}=await import('../lib/stock-webhook.ts');
 await fetchWith(async()=>{calls++;return new Response('',{status:403});},async()=>{await assert.rejects(()=>reconcileOpenStock());assert.equal((await reconcileOpenStock()).throttled,true);assert.equal(calls,1);assert.equal((await stockSnapshot('stock-cursor:all')).at,at);});
});
test('on-open mode coalesces sellers and disables scheduled/global automatic work',async()=>{
 await reset();globalThis.__testCloudflareEnv.MOYSKLAD_MODE='on-open';let calls=0;
 try{const {POST}=await import('../app/api/stock/route.ts');const {scheduledStockSync}=await import('../lib/stock-webhook.ts');
 const request=()=>new Request('https://example.test/api/stock',{method:'POST',body:JSON.stringify({view:true,scope:'used',targets:[{store:p.store,url:p.url}]})});
 await fetchWith(async()=>{calls++;return Response.json([{assortmentId:id,storeId:stockWarehouses[0].id,stock:2}]);},async()=>{
 const [a,b]=await Promise.all([POST(request()),POST(request())]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,1);const pair=await Promise.all([a.json(),b.json()]);assert.ok(pair.every(r=>JSON.stringify(r.values[key])===JSON.stringify([2,0,0])));assert.equal(pair.filter(r=>r.cached).length,1);
 const read=await(await GET(new Request('https://example.test/api/stock?scope=used'))).json();assert.equal(read.onOpen,true);assert.equal(read.realtime,false);assert.equal((await scheduledStockSync()).paused,true);assert.equal((await syncStock()).paused,true);assert.equal(calls,1);
 const cached=await(await POST(request())).json();assert.equal(cached.cached,true);assert.equal(calls,1);
 const raw=await stockSnapshot('stock-current:'+id);raw.warehouseCheckedAt=raw.warehouseCheckedAt.map(()=>new Date(Date.now()-31000).toISOString());await putStockSnapshot('stock-current:'+id,raw);await POST(request());assert.equal(calls,2);
 });}finally{delete globalThis.__testCloudflareEnv.MOYSKLAD_MODE;}
});
test('Open Box import uses a filtered lightweight assortment and persists stock without mixing sealed cards',async()=>{await reset();globalThis.__testCloudflareEnv.MOYSKLAD_MODE='on-open';let calls=0;const currency='https://api.moysklad.ru/api/remap/1.2/entity/currency/22222222-2222-2222-2222-222222222222';try{await fetchWith(async(url,options)=>{calls++;if(url.includes('entity/assortment')){assert.equal(new URL(url).searchParams.get('filter'),'name~MacBook');assert.equal(options.headers['X-Lognex-Remap-Beta-Feature'],'assortmentWithoutStock');return Response.json({meta:{size:1},rows:[{meta:{href},name:'MacBook Air 15 M3 8GB 256GB Midnight (Open Box)',salePrices:[{value:4000000,currency:{meta:{href:currency}},priceType:{name:'Розничная'}}]}]});}if(url.includes('entity/currency'))return Response.json({rows:[{meta:{href:currency},isoCode:'UAH'}]});assert.match(url,/bystore\/current/);return Response.json([{assortmentId:id,storeId:stockWarehouses[0].id,stock:1}]);},async()=>{const {POST}=await import('../app/api/stock/open-box/route.ts');const req=()=>new Request('https://example.test/api/stock/open-box',{method:'POST',body:'{}'});const response=await POST(req());assert.equal(response.status,200);const result=await response.json();assert.equal(result.products.length,1);assert.equal(result.products[0].price,'40000');assert.equal((await stockSnapshot('open-box-catalog')).products[0].edition,'OpenBox');assert.equal(calls,3);assert.equal((await(await POST(req())).json()).cached,true);assert.equal(calls,3);assert.equal((await stockSnapshot('catalog')).products.length,1);});}finally{delete globalThis.__testCloudflareEnv.MOYSKLAD_MODE;}});
