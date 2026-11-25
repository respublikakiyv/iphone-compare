import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parsePage} from '../lib/store-parser.ts';
import {priceLabel,copyPrices} from '../lib/catalog.ts';
import {refreshDevice,saveDevice,readDevice} from '../lib/device-catalog.ts';

const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const cases=[
 {name:'jabko_preorder_esim.html',store:'Jabko',url:'https://jabko.ua/product/apple-iphone-17-256gb-black-e-sim',sim:'esim',price:'44999'},
 {name:'jabko_preorder_physical.html',store:'Jabko',url:'https://jabko.ua/product/apple-iphone-17-512gb-white',sim:'physical',price:'57099'},
 {name:'ipeople_glacier_preorder.html',store:'iPeople',url:'https://ipeople.ua/products/smartfon-apple-iphone-18-pro-1tb-glacier-mjt24',sim:'physical',price:'115515'},
];

for(const c of cases)test(`live preorder fixture recovers ${c.store} ${c.sim} price`,()=>{
 const p=parsePage(c.store,fixture(c.name),c.url).record;
 assert.equal(p.price,c.price);assert.equal(p.sim,c.sim);assert.equal(p.status,'preorder');assert.equal(priceLabel(p),'Под заказ');
 assert.ok(p.last_success_at);assert.match(copyPrices([p],'45'),new RegExp(`${c.price}грн$`));
 if(c.store==='iPeople')assert.equal(p.color,'Glacier Blue');
});

test('preorder still requires the selected SIM URL, title and matching rendered price',()=>{
 const c=cases[0],html=fixture(c.name);
 const changedPrice=html.replace('<span class="price-new__uah">44 999 грн</span>','<span class="price-new__uah">57 099 грн</span>');
 assert.notEqual(changedPrice,html);
 const p=parsePage(c.store,changedPrice,c.url).record;
 assert.equal(p.price,null);assert.equal(p.status,'error');
 const wrongUrl=parsePage(c.store,html,'https://jabko.ua/unrelated').record;
 // Its canonical URL may authorize a legitimate redirect, but a foreign selected link cannot.
 const changedLink=html.replaceAll(c.url,'https://jabko.ua/other-phone');
 const mismatch=parsePage(c.store,changedLink.replace('rel="canonical"','rel="alternate"'),c.url).record;
 assert.equal(mismatch.price,null);assert.equal(mismatch.status,'error');
 assert.ok(wrongUrl);
});

test('price refresh replaces cached nulls and saves recovered prices on the device',async()=>{
 const verified=cases.map(c=>parsePage(c.store,fixture(c.name),c.url).record);
 const previous=verified.map(p=>({...p,price:null,status:'error',checked_at:'2026-10-13T00:00:00Z',last_success_at:null}));
 const local=new Map();global.localStorage={setItem:(k,v)=>local.set(k,v),getItem:k=>local.get(k)||null};
 const byUrl=new Map(verified.map(p=>[p.url,p]));
 const result=await refreshDevice('prices',{products:previous,stores:{}},async(_,url)=>({record:byUrl.get(url)}),(catalog,job)=>saveDevice('recovery',{catalog,job,rate:'45'}),new AbortController().signal,'new',['iPeople','Jabko']);
 assert.equal(result.job.status,'succeeded');
 assert.deepEqual(readDevice('recovery').catalog.products.map(p=>p.price),verified.map(p=>p.price));
 assert.ok(result.catalog.products.every(p=>p.last_success_at!=='2026-10-13T00:00:00Z'));
});

test('full catalog reports unparsed prices as partial and preserves history and full-update date',async()=>{
 const verified=parsePage(cases[2].store,fixture(cases[2].name),cases[2].url).record;
 const oldDate='2026-10-13T00:00:00Z';
 const read=async(store,url)=>url.endsWith('/iphone/')?{catalogPage:true,urls:store==='iPeople'?[verified.url]:[],next:null}:{record:{...verified,price:null,status:'error',last_success_at:null},variants:[]};
 const result=await refreshDevice('catalog',{products:[verified],stores:{iPeople:{full_updated_at:oldDate}}},read,()=>{},new AbortController().signal,'new',['iPeople','Jabko']);
 assert.equal(result.job.status,'partial');assert.equal(result.catalog.stores.iPeople.status,'error');
 assert.match(result.catalog.stores.iPeople.message,/не удалось проверить: 1/);
 assert.equal(result.catalog.stores.iPeople.full_updated_at,oldDate);
 assert.equal(result.catalog.products[0].price,verified.price);assert.equal(result.catalog.products[0].status,'error');
});

test('unverified product is an error, while deliberately excluded used eSIM is skipped',async()=>{
 const c=cases[2],verified=parsePage(c.store,fixture(c.name),c.url).record;
 const old={...verified,edition:'Used'};
 const read=async(_,url)=>url.includes('/b-u-tekhnyka-ua/')?{catalogPage:true,urls:[old.url,'https://ipeople.ua/used-esim','https://ipeople.ua/missing-sim'],next:null}:url===old.url?{record:old,variants:[]}:url.endsWith('used-esim')?{record:null,ignored:true,variants:[]}:{record:null,ignored:false,variants:[]};
 const result=await refreshDevice('catalog',{products:[old],stores:{}},read,()=>{},new AbortController().signal,'used');
 assert.equal(result.job.status,'partial');assert.equal(result.catalog.stores['iPeople:used'].status,'partial');
 assert.match(result.catalog.stores['iPeople:used'].message,/не удалось проверить: 1/);
 assert.equal(result.catalog.products[0].price,old.price);
});
