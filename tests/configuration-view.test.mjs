import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {selectHardware,emptyHardwareChoice,ipadNetwork,watchBandType,screenGlass} from '../lib/configuration-filters.ts';
import {hardwareCatalog} from '../lib/product-selection.ts';
import {priceCardRows} from '../lib/comparison-view.ts';
import {hasPrice} from '../lib/catalog.ts';
import {comparisonGroups} from '../lib/apple-products.ts';
const p=(category,title,extra={})=>({category,full_title:title,model:title,storage:'256GB',store:'iPeople',url:'https://ipeople.ua/'+encodeURIComponent(title),price:'50000',color:'Silver',sim:'unknown',status:'ok',sku:null,...extra});
test('Pro offers only Pro and Max, generation is newest known, glass remains independent',()=>{
 const products=[p('mac','MacBook Pro 14 M5'),p('mac','MacBook Pro 14 M4 Pro'),p('mac','MacBook Pro 14 M5 Pro'),p('mac','MacBook Pro 14 M5 Pro Nano-texture'),p('mac','MacBook Pro 16 M5 Max')];const facts=hardwareCatalog(products);
 const s=selectHardware(products,facts,'mac',{...emptyHardwareChoice,deviceClass:'Pro'});assert.deepEqual(s.options.tier,['Pro','Max']);assert.equal(s.values.generation,'M5');assert.equal(s.values.glass,'standard');assert.equal(s.products.length,1);
 const nano=selectHardware(products,facts,'mac',{...s.values,glass:'nano'});assert.equal(nano.products.length,1);assert.equal(screenGlass(nano.products[0]),'nano');
});
test('iPad defaults to a known chip with actual prices and keeps Wi-Fi separate from Cellular',()=>{
 const products=[p('ipad','iPad Pro 11 4 Gen Wi-Fi'),p('ipad','iPad Pro 11 M4 Wi-Fi'),p('ipad','iPad Pro 11 M5 Wi-Fi'),p('ipad','iPad Pro 11 M5 Wi-Fi + Cellular'),p('ipad','iPad Pro 13 M6 Wi-Fi',{price:null})];const facts=hardwareCatalog(products);
 const s=selectHardware(products,facts,'ipad',{...emptyHardwareChoice,deviceClass:'Pro'});assert.equal(s.values.generation,'M5');assert.equal(s.values.network,'wifi');assert.equal(s.products.length,1);assert.equal(ipadNetwork(s.products[0]),'wifi');
 const cellular=selectHardware(products,facts,'ipad',{...s.values,network:'cellular'});assert.equal(cellular.products.length,1);assert.equal(ipadNetwork(cellular.products[0]),'cellular');assert.equal(ipadNetwork(p('ipad','iPad Pro 11 Wi‑Fi 256GB')),'wifi');
});
test('Watch strap type ignores colour and fit while distinguishing each construction',()=>{
 for(const type of ['Sport Band','Sport Loop','Ocean Band','Alpine Loop','Trail Loop','Milanese Loop','Titanium Milanese Loop'])assert.equal(watchBandType(p('watch','Watch Ultra 4 Black '+type+' M/L')),type);
 assert.equal(watchBandType(p('watch','Watch Series 11 Silver S. Band S/M')),'Sport Band');
});
test('cards preserve valid prices, select a priced representative and never render an empty price group',()=>{
 const unavailable=p('other','Apple Pencil Pro',{price:null,sku:'MX2D3'}),priced={...unavailable,store:'Jabko',url:'https://jabko.ua/pencil',price:'4999'};
 const empty=p('other','HomePod mini',{price:null,sku:'MY5G2'});
 const rows=priceCardRows([unavailable,priced,empty]);assert.equal(rows.length,1);assert.equal(rows[0].Jabko.price,'4999');assert.equal(rows[0].offers.some(hasPrice),true);
});
test('same iPad article joins complete and sparse retailer names without mixing screen sizes',()=>{
 const a=p('ipad','iPad Pro 11 M5 256GB Wi-Fi',{sku:'MDWK4'}),b=p('ipad','iPad Pro M5 256GB Wi-Fi',{sku:'MDWK4',store:'Jabko'});
 assert.equal(comparisonGroups([a,b]).length,1);assert.equal(comparisonGroups([a,{...b,full_title:'iPad Pro 13 M5 256GB Wi-Fi'}]).length,2);
});

test('same article never bridges known iPad A-series chip generations',()=>{
 const a=p('ipad','iPad mini 7 Wi-Fi 256GB',{sku:'MXNC3'}),b=p('ipad','iPad mini 6 Wi-Fi 256GB',{sku:'MXNC3',store:'Jabko'});assert.equal(comparisonGroups([a,b]).length,2);
});
