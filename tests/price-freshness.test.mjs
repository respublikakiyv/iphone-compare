import test from 'node:test';
import assert from 'node:assert/strict';
import {priceRefreshStatus,pricesStale} from '../lib/app-settings.ts';
import {refreshDevice} from '../lib/device-catalog.ts';
const now=Date.now(),fresh=new Date(now).toISOString(),old=new Date(now-7*3600000).toISOString();
const product=(store='iPeople',url='https://ipeople.ua/product/17')=>({store,url,model:'17',storage:'256GB',sim:'physical',edition:'Standard',color:'Black',price:'40000',status:'ok',checked_at:fresh,last_success_at:fresh});
const status=(catalog,stores=['iPeople'],at=now,used=false)=>priceRefreshStatus(catalog,stores,6,at,used);

test('fresh card observations clear an obsolete store watermark; irrelevant old inventory is ignored',()=>{
 const catalog={products:[product(),{...product(),store:'Jabko',model:'16',last_success_at:old},{...product(),edition:'Used',last_success_at:old}],stores:{iPeople:{prices_updated_at:old,status:'partial',updated_at:fresh}}};
 assert.deepEqual(status(catalog).stores,[]);assert.equal(pricesStale(catalog,['iPeople'],6,now),false);
});
test('a fresh store summary never conceals stale or future card observations',()=>{
 for(const stamp of [old,new Date(now+3600000).toISOString()]){
  const catalog={products:[{...product(),last_success_at:stamp}],stores:{iPeople:{prices_updated_at:fresh}}};
  assert.deepEqual(status(catalog).staleStores,['iPeople']);assert.equal(status(catalog).staleCount,1);
 }
});
test('a successful refresh removes the reminder immediately',async()=>{
 const p={...product(),checked_at:old,last_success_at:old};const initial={products:[p],stores:{iPeople:{prices_updated_at:old}}};
 assert.equal(status(initial).staleCount,1);
 const result=await refreshDevice('prices',initial,async()=>({record:{...p,checked_at:fresh,last_success_at:fresh}}),()=>{},new AbortController().signal,'new',['iPeople']);
 assert.equal(result.job.status,'succeeded');assert.deepEqual(status(result.catalog).stores,[]);
});
test('partial refresh reports only failed cards and a successful retry clears the warning',async()=>{
 const first={...product(),checked_at:old,last_success_at:old},second={...first,url:first.url+'-second'};
 const initial={products:[first,second],stores:{iPeople:{prices_updated_at:old}}};
 const result=await refreshDevice('prices',initial,async(_,url)=>{if(url===second.url)throw Error('network');return {record:{...first,checked_at:fresh,last_success_at:fresh}};},()=>{},new AbortController().signal,'new',['iPeople']);
 const notice=status(result.catalog);assert.deepEqual(notice.failedStores,['iPeople']);assert.equal(notice.failedCount,1);assert.equal(notice.staleCount,0);
 assert.equal(result.catalog.stores.iPeople.prices_updated_at,old);assert.equal(result.catalog.products[1].price,second.price);
 const retry=await refreshDevice('prices',result.catalog,async(_,url)=>({record:{...product('iPeople',url),checked_at:fresh,last_success_at:fresh}}),()=>{},new AbortController().signal,'new',['iPeople']);
 assert.deepEqual(status(retry.catalog).stores,[]);
});
test('blocked store warning leaves successfully refreshed stores out of the retry',async()=>{
 const products=[{...product(),checked_at:old,last_success_at:old},{...product('Jabko','https://jabko.ua/17'),checked_at:old,last_success_at:old}];
 const result=await refreshDevice('prices',{products,stores:{}},async(store,url)=>{if(store==='iPeople')throw Error('source_challenge');return {record:{...product(store,url),checked_at:fresh,last_success_at:fresh}};},()=>{},new AbortController().signal,'new',['iPeople','Jabko']);
 assert.deepEqual(status(result.catalog,['iPeople','Jabko']).stores,['iPeople']);
});
test('recent confirmed 404 preserves old price history without repeatedly requesting an update',async()=>{
 const p={...product(),checked_at:old,last_success_at:old};
 const result=await refreshDevice('prices',{products:[p],stores:{}},async()=>{throw Error('http_404');},()=>{},new AbortController().signal,'new',['iPeople']);
 assert.equal(result.catalog.products[0].last_success_at,old);assert.equal(result.catalog.products[0].price,p.price);
 assert.deepEqual(status(result.catalog).stores,[]);
 assert.deepEqual(status(result.catalog,['iPeople'],now+7*3600000).staleStores,['iPeople']);
});
test('new and used inventories and disabled stores have independent reminders',()=>{
 const catalog={products:[product(),{...product(),edition:'Used',last_success_at:old},{...product('Jabko'),last_success_at:old}],stores:{}};
 assert.deepEqual(status(catalog).stores,[]);assert.deepEqual(status(catalog,['iPeople'],now,true).staleStores,['iPeople']);
});
test('cancelled refresh cannot clear a stale reminder',async()=>{
 const initial={products:[{...product(),checked_at:old,last_success_at:old}],stores:{}};const controller=new AbortController();controller.abort();
 await assert.rejects(refreshDevice('prices',initial,async()=>({record:product()}),()=>{},controller.signal),/остановлено/);
 assert.deepEqual(status(initial).staleStores,['iPeople']);
});
test('a complete catalog confirms missing offers without changing their historical price date',()=>{
 const catalog={products:[{...product(),status:'unavailable',checked_at:old,last_success_at:old}],stores:{iPeople:{status:'ok',full_updated_at:fresh}}};
 assert.deepEqual(status(catalog).stores,[]);assert.deepEqual(status(catalog,['iPeople'],now+7*3600000).staleStores,['iPeople']);
});
test('old but successful prices never inflate failed counts after a different card fails',()=>{
 const failed={...product(),url:'https://ipeople.ua/failure',status:'error'},stale={...product(),url:'https://ipeople.ua/stale',last_success_at:old};
 const result=status({products:[failed,stale],stores:{iPeople:{status:'error',updated_at:fresh}}});assert.equal(result.failedCount,1);assert.equal(result.staleCount,1);assert.deepEqual(result.failedStores,['iPeople']);assert.deepEqual(result.staleStores,['iPeople']);assert.deepEqual(result.stores,['iPeople']);
});
