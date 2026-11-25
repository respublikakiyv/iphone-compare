import test from 'node:test';import assert from 'node:assert/strict';
import {priceMessage} from '../lib/boss-draft.ts';
import {bossDraftLink} from '../lib/boss-draft.ts';
const p={store:'iPeople',url:'https://ipeople.ua/p',model:'18 Pro',storage:'256GB',sim:'physical',color:'Black',edition:'Standard',price:'90000',status:'ok',checked_at:'2026-10-14T00:00:00Z'};
test('boss draft targets exact contact and contains the same copy text',()=>{const offers=[p,{...p,store:'Jabko',price:'90045'}];const u=new URL(bossDraftLink(offers,'45'));assert.equal(u.origin,'https://t.me');assert.equal(u.pathname,'/Gerasim_vlad');assert.deepEqual([...u.searchParams.keys()],['text']);assert.equal(u.searchParams.get('text'),priceMessage(offers,'45'));assert.equal(u.searchParams.get('text'),'iPhone 18 Pro 256 GB Black\n\niPeople\n90 000 ₴ · $2 000\n\nЯбко\n90 045 ₴ · $2 001');});
test('used draft preserves used marker, single shop and changed exchange rate',()=>{const used={...p,edition:'Used',model:'15 Pro Max',price:'36240'};const u=new URL(bossDraftLink([used],'40'));assert.equal(u.searchParams.get('text'),priceMessage([used],'40'));assert.match(u.searchParams.get('text'),/^Б\/У iPhone/);assert.match(u.searchParams.get('text'),/iPeople\n36 240 ₴ · \$906/);assert.ok(!u.searchParams.get('text').includes('ябко'));});
test('missing rate or prices cannot generate an empty draft',()=>{assert.throws(()=>bossDraftLink([p],null),/курс/);assert.throws(()=>bossDraftLink([{...p,price:null}],'45'),/цен/);});

test('mini app opens the full draft inside Telegram without launching a browser',async()=>{
 const {openBossDraft}=await import('../lib/boss-draft.ts');const calls=[];
 const app={openTelegramLink:(...args)=>calls.push(args),openLink:()=>assert.fail('Must not launch a browser')};
 const offers=[p,{...p,store:'Jabko',price:'90045'},{...p,store:'iSpace',sim:'unknown',price:'91000'}];
 openBossDraft(offers,'45','Gerasim_vlad',app,()=>assert.fail('Unexpected native fallback'));
 assert.equal(calls.length,1);const link=new URL(calls[0][0]);assert.equal(link.pathname,'/Gerasim_vlad');assert.equal(link.searchParams.get('text'),priceMessage(offers,'45'));assert.equal(calls[0].length,1);
});
test('native fallback retains recipient, Cyrillic, newlines and all prices',async()=>{
 const {openBossDraft}=await import('../lib/boss-draft.ts');for(const app of [undefined,{openTelegramLink(){throw Error('unsupported');}}]){let opened;openBossDraft([p],'45','Gerasim_vlad',app,url=>opened=new URL(url));assert.equal(opened.protocol,'tg:');assert.equal(opened.hostname,'resolve');assert.equal(opened.searchParams.get('domain'),'Gerasim_vlad');assert.equal(opened.searchParams.get('text'),priceMessage([p],'45'));}
});
test('invalid draft never opens a chat',async()=>{const {openBossDraft}=await import('../lib/boss-draft.ts');let opened=false;assert.throws(()=>openBossDraft([p],null,'Gerasim_vlad',{openTelegramLink(){opened=true;}},()=>{opened=true;}),/курс/);assert.equal(opened,false);});
test('message adds the Apple article to the device title and ignores numeric shop IDs',()=>{
 assert.match(priceMessage([{...p,sku:'MG6J4UA/A'}],'45'),/^iPhone 18 Pro 256 GB Black \(MG6J4UA\/A\)\n\n/);
 assert.match(priceMessage([{...p,sku:'1234567',full_title:'iPhone 18 Pro 256GB Black (MG6J4)'}],'45'),/^iPhone 18 Pro 256 GB Black \(MG6J4\)/);
 assert.doesNotMatch(priceMessage([{...p,sku:'1234567'}],'45'),/1234567/);
 const mac={...p,category:'mac',model:'MacBook Air M5',full_title:'MacBook Air 15 M5 16GB 512GB (MDVQ4)',sku:'MDVQ4',storage:'512GB',sim:'unknown'};
 assert.equal(priceMessage([mac],'45').split('MDVQ4').length,2);
});
test('message chooses one price per shop and discloses retained or preorder prices',()=>{
 const text=priceMessage([{...p,price:'95000',status:'unavailable'},{...p,price:'90000'}, {...p,store:'Jabko',status:'preorder',price:'89000'}, {...p,store:'Comfy',status:'error',price:'88000'}],'45');
 assert.equal((text.match(/iPeople/g)||[]).length,1);assert.doesNotMatch(text,/95 000/);assert.match(text,/Под заказ/);assert.match(text,/Последняя подтверждённая цена/);
});
