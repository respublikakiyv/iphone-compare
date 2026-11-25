import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parsePage} from '../lib/store-parser.ts';
import {refreshDevice,repairDeviceSeed,needsSeedRepair,SEED_REVISION} from '../lib/device-catalog.ts';
import {priceLabel} from '../lib/catalog.ts';

const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const airUrl='https://jabko.ua/product/apple-iphone-17-air-256gb-black-e-sim';
const eUrl='https://jabko.ua/product/apple-iphone-17e-256gb-black';
const usedUrl='https://ipeople.ua/products/b-u-smartfon-apple-iphone-17-256gb-black';
const air=()=>parsePage('Jabko',fixture('jabko_air_single_sim.html'),airUrl).record;
const phone=()=>parsePage('Jabko',fixture('jabko_17e.html'),eUrl).record;
const used=()=>parsePage('iPeople',fixture('ipeople_used_17.html'),usedUrl,'used').record;

test('Air single eSIM layout uses confirmed specs, Standard swatch and displayed price',()=>{
 const p=air();assert.equal(p.model,'17 Air');assert.equal(p.sim,'esim');assert.equal(p.price,'45499');assert.equal(p.status,'ok');
 // The page schema has the higher instalment price; the card shows the selected offer.
 assert.notEqual(p.price,'46949');
 const badSpecs=fixture('jabko_air_single_sim.html').replaceAll('eSim','unknown');
 assert.equal(parsePage('Jabko',badSpecs,airUrl).record,null);
 const mismatched=fixture('jabko_air_single_sim.html').replace('45 499 грн','99 999 грн');
 const invalid=parsePage('Jabko',mismatched,airUrl).record;
 assert.equal(invalid.price,null);assert.equal(invalid.status,'error');
});

test('17e without state selector is new even though an inactive Ultra edition is linked',()=>{
 const p=phone();assert.equal(p.model,'17e');assert.equal(p.sim,'physical');assert.equal(p.price,'35599');assert.equal(p.status,'ok');
 const selectedUltra=fixture('jabko_17e.html').replace('data-label="Standard"','data-label="Ultra"');
 assert.equal(parsePage('Jabko',selectedUltra,eUrl).record,null);
 const usedName=fixture('jabko_17e.html').replaceAll('Apple iPhone 17e','Б/У iPhone 17e');
 assert.equal(parsePage('Jabko',usedName,eUrl).record,null);
});

test('visible unavailable price is retained without claiming stock',()=>{
 const html=fixture('jabko_17e.html').replaceAll('Залишилось мало','Немає в наявності').replaceAll('\\u0417\\u0430\\u043b\\u0438\\u0448\\u0438\\u043b\\u043e\\u0441\\u044c \\u043c\\u0430\\u043b\\u043e','Немає в наявності');
 const p=parsePage('Jabko',html,eUrl).record;
 assert.equal(p.price,'35599');assert.equal(p.status,'unavailable');assert.match(priceLabel(p),/Нет в наличии/);
});

test('memory and colour variants are followed, while Ultra and used variants are excluded',()=>{
 const result=parsePage('Jabko',fixture('jabko_air_single_sim.html'),airUrl);
 assert.ok(result.variants.some(u=>u.includes('512gb')));assert.ok(result.variants.some(u=>u.includes('128gb')));
 assert.ok(result.variants.every(u=>!u.includes('ultra')&&!u.includes('/bu-')));
});

test('used 17 is verified as physical SIM, with a separate used record and price',()=>{
 const p=used();assert.equal(p.model,'17');assert.equal(p.edition,'Used');assert.equal(p.sim,'physical');assert.equal(p.price,'38505');
 assert.equal(parsePage('iPeople',fixture('ipeople_used_17.html').replaceAll('Nano-SIM + eSIM','eSIM'),usedUrl,'used').record,null);
});

test('category discovery includes used 17 subcategories and avoids new/used crossovers',()=>{
 const html='<a href="/b-u-tekhnyka-ua/b-u-iphone-ua/b-u-iphone-17">Б/У iPhone 17</a><a href="/apple-ua/iphone/iphone-17">iPhone 17</a>';
 const r=parsePage('iPeople',html,'https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua','used');
 assert.deepEqual(r.categories,['https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua/b-u-iphone-17']);assert.equal(r.catalogPage,true);
});

test('full used crawl follows subcategories and pages once and survives unverified old cards',async()=>{
 const p=used(),root='https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua',category=root+'/b-u-iphone-17',second=root+'/?page=2',calls=[];
 const invalid=[1,2,3].map(n=>'https://ipeople.ua/products/b-u-iphone-15-unknown-'+n);
 const last={...p,url:'https://ipeople.ua/products/b-u-iphone-14-black',model:'14'};
 const result=await refreshDevice('catalog',{products:[],stores:{}},async(_,url)=>{
  calls.push(url);
  if(url===root)return {catalogPage:true,urls:invalid,categories:[category],next:second};
  if(url===category)return {catalogPage:true,urls:[p.url],categories:[category,root+'/'],next:null};
  if(url===second)return {catalogPage:true,urls:[p.url,last.url],categories:[category],next:null};
  return invalid.includes(url)?{record:null,ignored:false,variants:[]}:{record:url===p.url?p:last,variants:[]};
 },()=>{},new AbortController().signal,'used');
 assert.equal(calls.filter(u=>u===category).length,1);assert.equal(calls.filter(u=>u===p.url).length,1);
 assert.ok(calls.indexOf(p.url)<calls.indexOf(invalid[0]));assert.ok(calls.includes(last.url));
 assert.equal(result.job.status,'partial');assert.equal(result.catalog.products.length,2);
});

test('one-time device repair adds missing 17e/Air and physical used 17 without overwriting local prices or rate',()=>{
 const now=Date.now(),local={...phone(),price:'36000'},snapshot={products:[phone(),air(),used(),{...used(),url:usedUrl+'/esim',sim:'esim'}],stores:{},seed_revision:SEED_REVISION,updated_at:new Date(now).toISOString()};
 const state={catalog:{products:[local],stores:{}},rate:'45',job:{status:'succeeded'}};
 assert.equal(needsSeedRepair(state.catalog,now),true);
 const next=repairDeviceSeed(state,snapshot,now);
 assert.equal(next.catalog.products.length,3);assert.equal(next.catalog.products[0].price,'36000');assert.equal(next.rate,'45');assert.equal(next.job,state.job);
 assert.equal(needsSeedRepair(next.catalog,now),false);assert.equal(repairDeviceSeed(next,snapshot,now).catalog.products.length,3);
});
