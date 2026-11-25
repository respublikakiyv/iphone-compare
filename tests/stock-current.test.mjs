import test from 'node:test';import assert from 'node:assert/strict';
import {currentStockUrl,currentChangesUrl,applyCurrent,aggregateCurrent,changedSince} from '../lib/stock-current.ts';
import {stockWarehouses} from '../lib/warehouse-stock.ts';
const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222',href=id=>'https://api.moysklad.ru/api/remap/1.2/entity/product/'+id,at='2026-10-19T12:00:00.000Z';
const row=(id,stock,i=0)=>({assortmentId:id,storeId:stockWarehouses[i].id,stock});
test('one short request selects only card IDs and all three warehouses',()=>{const q=new URL(currentStockUrl([a,a,b])).searchParams;assert.equal(q.get('filter'),'assortmentId='+a+','+b+';storeId='+stockWarehouses.map(w=>w.id).join(','));assert.equal(q.get('withRecalculate'),'true');assert.equal(q.get('include'),'zeroLines');assert.throws(()=>currentStockUrl(['foreign']));});
test('complete short report fills omitted never-operated warehouse with zero',()=>{assert.deepEqual(applyCurrent([a],[row(a,1)],{},at).values[a].values,[1,0,0]);});
test('delta is absolute, sold-out zero is applied and absent pairs remain unchanged',()=>{const old={[a]:{values:[3,2,1],checkedAt:at},[b]:{values:[4,5,6],checkedAt:at}},rows=[row(a,0)];const one=applyCurrent([a,b],rows,old,at,true);assert.deepEqual(one.values[a].values,[0,2,1]);assert.deepEqual(one.values[b].values,[4,5,6]);assert.deepEqual(applyCurrent([a,b],rows,one.values,at,true),one);});
test('pending recalculation preserves quantity and marks incomplete, never zero',()=>{const r=applyCurrent([a],[row(a,null)],{[a]:{values:[2,1,1],checkedAt:at}},at);assert.deepEqual(r.values[a].values,[2,0,0]);assert.deepEqual(r.pending,[a]);assert.equal(applyCurrent([a],[row(a,null)],{},at).values[a].values[0],null);});
test('invalid, foreign or duplicate data rejects whole batch',()=>{for(const rows of [[row(a,'3')],[row(b,2)],[row(a,1),row(a,2)],[{...row(a,1),storeId:'other'}]])assert.throws(()=>applyCurrent([a],rows,{},at));});
test('aggregation deduplicates IDs and refuses to invent unknown quantities',()=>{const raw={[a]:{values:[1,2,3],checkedAt:at},[b]:{values:[2,0,1],checkedAt:at}};assert.deepEqual(aggregateCurrent([href(a),href(a),href(b)],raw),[3,2,4]);assert.deepEqual(aggregateCurrent([],raw),[null,null,null]);assert.deepEqual(aggregateCurrent([href(a),href(b)],{[a]:raw[a]}),[null,null,null]);});
test('incremental checkpoint uses Moscow time and overlap, old or future checkpoints require full',()=>{const now=Date.parse(at);assert.equal(changedSince(at,now),'2026-10-19 14:58:00');assert.equal(changedSince('2026-10-18T00:00:00Z',now),undefined);assert.equal(changedSince('2026-10-20T00:00:00Z',now),undefined);});
test('daily identity discovery uses lightweight assortment pages and selected Apple folders',async()=>{
 const {readStockMetadata}=await import('../lib/stock-metadata.ts');const calls=[];
 const r=await readStockMetadata(async url=>{const q=new URL(url).searchParams;calls.push(q);assert.ok(q.get('filter').includes('withSubFolders=true'));assert.match(url,/entity\/assortment/);const n=Number(q.get('offset')),size=1001;return {meta:{size},rows:Array.from({length:Math.min(1000,size-n)},(_,i)=>({meta:{href:href(a)},name:'Б/У iPhone 17 256GB Black',pathName:'Б/У',stock:999}))};});
 assert.equal(calls.length,2);assert.equal(r.rows.length,1001);assert.equal(r.rows[0].stock,0);assert.equal(r.rows[0].folder,'Б/У');
 await assert.rejects(readStockMetadata(async()=>({meta:{size:1001},rows:[]})),/Incomplete/);
});

test('delta requests omit zeroLines because the provider includes zero automatically',()=>{
 for(const url of [currentStockUrl([a],'2026-10-19 15:00:00'),currentChangesUrl('2026-10-19 15:00:00')]){const q=new URL(url).searchParams;assert.equal(q.has('include'),false);assert.equal(q.has('changedSince'),true);}
 assert.equal(new URL(currentChangesUrl('2026-10-19 15:00:00')).searchParams.get('filter'),'storeId='+stockWarehouses.map(w=>w.id).join(','));
});

test('verification dates stay per warehouse: zero is checked, pending keeps its old date',async()=>{
 const {aggregateVerifiedAt}=await import('../lib/stock-current.ts');const later='2026-10-20T12:00:00.000Z',old={[a]:{values:[3,2,1],checkedAt:at,warehouseCheckedAt:[at,at,at]}};
 const full=applyCurrent([a],[row(a,null),row(a,0,1)],old,later);assert.deepEqual(full.values[a].values,[3,0,0]);assert.deepEqual(full.values[a].warehouseCheckedAt,[at,later,later]);
 const delta=applyCurrent([a],[row(a,0)],old,later,true);assert.deepEqual(delta.values[a].warehouseCheckedAt,[later,at,at]);assert.deepEqual(aggregateVerifiedAt([href(a)],delta.values),[later,at,at]);
 assert.deepEqual(aggregateVerifiedAt([href(a)],{[a]:{values:[0,null,1],checkedAt:at}}),[null,null,null]);
});
