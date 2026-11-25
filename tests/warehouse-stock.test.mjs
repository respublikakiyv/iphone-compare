import test from 'node:test';import assert from 'node:assert/strict';
import {quantityFor,rowStock,stockMatches,stockSearch,stockWarehouses} from '../lib/warehouse-stock.ts';
const p={store:'iPeople',url:'https://ipeople.ua/p',model:'17',storage:'256GB',sim:'physical',color:'Black',edition:'Standard',price:'45999',status:'ok',checked_at:''};
const row=(name,stock=1,id=name)=>({id,name,stock,folder:'01. Нова техніка (Apple)/iPhone'});
test('iPhone stock is exact across color, memory, family, SIM and condition',()=>{
 const rows=[row('iPhone 17 256GB Black (MG6J4)',3),row('iPhone 17 256GB White (MG6K4)',5),row('iPhone 17 512GB Black (MG6P4)',7),row('iPhone 17 Pro 256GB Black (MG8G4)',9),row('iPhone 17 256GB Black (MG6J4) eSIM',11),row('iPhone 17 256GB Black (MG6J4) (Open Box)',13),row('Б/У iPhone 17 256GB Black',15)];
 assert.equal(quantityFor(p,rows),3);assert.equal(quantityFor({...p,sim:'esim'},rows),11);assert.equal(quantityFor({...p,edition:'Used'},rows),15);
 assert.equal(quantityFor({...p,storage:'1TB'},rows),null);
});
test('zero and missing are different, stock is actual units including reserved ones',()=>{
 assert.equal(quantityFor(p,[{...row('iPhone 17 256GB Black (MG6J4)',0),reserve:2}]),0);
 assert.equal(quantityFor(p,[]),null);assert.equal(quantityFor(p,[row('iPhone 17 256GB Black (MG6J4)',1.5)]),null);
 assert.equal(quantityFor(p,[row('iPhone 17 256GB Black (MG6J4)',-1)]),-1);
});
test('stock sums separate assortment IDs once, never once per retailer',()=>{
 const r=row('iPhone 17 256GB Black (MG6J4)',2,'a');assert.equal(quantityFor(p,[r,r,{...r,id:'b',stock:3}]),5);
 assert.deepEqual(rowStock([p,{...p,store:'Jabko'}],{'iPeople|https://ipeople.ua/p':[2,0,null],'Jabko|https://ipeople.ua/p':[2,0,null]}),[2,0,null]);
 assert.deepEqual(rowStock([p,{...p,store:'Jabko'}],{'iPeople|https://ipeople.ua/p':[2,0,1],'Jabko|https://ipeople.ua/p':[3,0,1]}),[null,0,1]);
});
test('MacBook stock compares article with region, RAM, SSD and chip',()=>{
 const mac={...p,category:'mac',full_title:'MacBook Air 15 M5 16GB 512GB Silver (MDV94)',model:'MacBook Air 15 M5',sku:'MDV94',storage:'512GB',color:'Silver',sim:'unknown'};
 assert.equal(stockMatches(mac,row('MacBook Air 15 M5 16GB 512GB Silver (MDV94UA/A)')),true);
 assert.equal(stockMatches({...mac,sku:'123456'},row('MacBook Air 15 M5 16GB 512GB Silver (MDV94UA/A)')),true);
 for(const name of ['MacBook Air 15 M5 24GB 512GB Silver (MDV94)','MacBook Air 15 M4 16GB 512GB Silver (MDV94)','MacBook Air 15 M5 16GB 256GB Silver (MDV94)','MacBook Air 15 M5 16GB 512GB Midnight (MDV94)'])assert.equal(stockMatches(mac,row(name)),false,name);
});
test('AirPods ANC and standard articles remain distinct',()=>{
 const a={...p,category:'airpods',full_title:'AirPods 5 (MKFW4)',model:'AirPods 5',sku:'MKFW4',storage:'—',color:'—',sim:'unknown'};
 assert.equal(quantityFor(a,[row('AirPods 5 (MKFW4ZE/A)',2),row('AirPods 5 ANC (MKFT4ZE/A)',4)]),2);
});
test('stock searches are derived from known device families and warehouse order is fixed',()=>{
 assert.equal(stockSearch(p),'iPhone 17');assert.equal(stockSearch({...p,category:'mac',full_title:'Ноутбук Apple MacBook Air 15 M5 (MDV94)'}),'MacBook Air');
 assert.deepEqual(stockWarehouses.map(s=>s.label),['Р','Б','А']);
});
test('locked, CPO, refurbished and open-box inventory cannot inflate new stock',()=>{
 for(const suffix of ['Lock','CPO','Open Box','Demo','Refurbished'])assert.equal(stockMatches(p,row('iPhone 17 256GB Black ('+suffix+')')),false,suffix);
});
test('report pagination reaches the last page and preserves zero and used items',async()=>{
 const {readStockRows}=await import('../lib/moysklad-report.ts');const calls=[];
 const rows=await readStockRows('iPhone 17',0,async url=>{const q=new URL(url).searchParams;calls.push(q);return {meta:{size:3},rows:q.get('offset')==='0'?[{meta:{href:'a'},name:'iPhone 17 256GB Black',stock:0},{meta:{href:'case'},name:'Apple Clear Case for iPhone 17',stock:10}]:[{meta:{href:'used'},name:'Б/У iPhone 17 256GB Black',stock:2}]};});
 assert.equal(calls.length,2);assert.equal(calls[1].get('offset'),'2');assert.match(calls[0].get('filter'),/stockMode=all;quantityMode=all/);assert.deepEqual(rows.map(r=>r.id),['a','used']);assert.equal(rows[0].stock,0);
 await assert.rejects(()=>readStockRows('iPhone',0,async()=>({meta:{size:1},rows:[]})),/Incomplete/);
});
test('card refresh reads only its known assortment IDs across one warehouse',async()=>{
 const {readStockRows}=await import('../lib/moysklad-report.ts');const ids=['https://api.moysklad.ru/api/remap/1.2/entity/product/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'];let filter;
 await readStockRows('',1,async url=>{filter=new URL(url).searchParams.get('filter');return {meta:{size:0},rows:[]};},ids);
 assert.ok(!filter.includes('search='));assert.ok(filter.includes('product='+ids[0]));assert.ok(filter.includes(stockWarehouses[1].id));
});
test('used base refresh is confined to the used iPhone folder, including subfolders',async()=>{
 const {readStockRows,usedStockSearch}=await import('../lib/moysklad-report.ts');let filter;
 await readStockRows(usedStockSearch,0,async url=>{filter=new URL(url).searchParams.get('filter');return {meta:{size:0},rows:[]};});
 assert.ok(filter.includes('productFolder=https://api.moysklad.ru/api/remap/1.2/entity/productfolder/4730d7dd-edaf-11e3-ae1a-002590a28eca'));assert.ok(!filter.includes('search='));
});
test('full metadata discovery omits empty search instead of sending invalid provider filter',async()=>{
 const {readStockRows}=await import('../lib/moysklad-report.ts');await readStockRows('',0,async url=>{const filter=new URL(url).searchParams.get('filter');assert.ok(!filter.includes('search='));assert.ok(!filter.endsWith(';'));return {meta:{size:0},rows:[]};});
});

test('card display distinguishes checked zero, unknown quantities and conflicting cached offers',async()=>{
 const {rowStockDetails,stockProductKey}=await import('../lib/warehouse-stock.ts');const first={store:'iPeople',url:'https://ipeople.ua/a',category:'mac'},second={...first,store:'Jabko',url:'https://jabko.ua/a'},at='2026-10-20T10:00:00Z';
 const values={[stockProductKey(first)]:[0,null,2]},dates={[stockProductKey(first)]:[at,null,at]};
 const result=rowStockDetails([first],values,dates);assert.equal(result[0].quantity,0);assert.equal(result[0].checkedAt,at);assert.equal(result[1].quantity,null);assert.equal(result[1].checkedAt,null);
 const conflicting=rowStockDetails([first,second],{...values,[stockProductKey(second)]:[1,null,2]},dates);assert.equal(conflicting[0].quantity,null);assert.equal(conflicting[0].conflict,true);
});
