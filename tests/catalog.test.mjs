import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalColor,hasPrice,mergeCatalog,priceLabel,preferPrice} from '../lib/catalog.ts';
const p={store:'iPeople',url:'https://ipeople.ua/p',model:'18 Pro Max',storage:'512GB',sim:'physical',color:'Glacier',edition:'Standard',price:'88335',status:'preorder',checked_at:'2026-10-14T08:00:00Z'};
test('verified glacier aliases compare together only for 18 Pro family',()=>{assert.equal(canonicalColor(p.model,p.color),canonicalColor(p.model,'Glacier Blue'));assert.equal(canonicalColor('17','Glacier'),'Glacier');});
test('network failure retains historical price and timestamp',()=>{const next=mergeCatalog({products:[p]},{products:[{...p,price:null,status:'error',checked_at:'2026-10-14T09:00:00Z'}]});const r=next.products[0];assert.equal(r.price,'88335');assert.equal(r.last_success_at,p.checked_at);assert.ok(hasPrice(r));assert.equal(priceLabel(r),'Последняя подтверждённая цена');});
test('absent catalog row retains history without claiming stock',()=>{const r=mergeCatalog({products:[p]},{products:[]}).products[0];assert.equal(r.status,'unavailable');assert.equal(r.price,p.price);assert.match(priceLabel(r),/Нет в наличии/);});
test('never transfer a price between SIM, memory or model variants',()=>{for(const change of [{sim:'esim'},{storage:'1TB'},{model:'18 Pro'},{color:'Black'}]){const r=mergeCatalog({products:[p]},{products:[{...p,...change,price:null,status:'error'}]}).products[0];assert.equal(r.price,null);}});
test('never invent prices for new cards',()=>{const r=mergeCatalog(null,{products:[{...p,price:null,status:'error'}]}).products[0];assert.equal(hasPrice(r),false);assert.equal(priceLabel(r),'Цена не подтверждена');});
test('category-specific minimums hide impossible non-iPhone prices',()=>{assert.equal(hasPrice({...p,category:'mac',price:'1500'}),false);assert.equal(hasPrice({...p,category:'mac',price:'6153'}),false);assert.equal(hasPrice({...p,category:'ipad',price:'2999'}),false);assert.equal(hasPrice({...p,category:'watch',price:'1500'}),true);assert.equal(hasPrice({...p,category:'airpods',price:'1000'}),true);assert.equal(hasPrice({...p,category:'ipad',price:'36899'}),true);});
test('current offer preferred over a cheaper historical price',()=>{assert.equal(preferPrice({...p,status:'ok',price:'90000'},{...p,status:'error',price:'80000'}),true);});
import {copyPrices} from '../lib/catalog.ts';
const named={...p,full_title:'Apple iPhone 18 Pro Max 512GB Glacier (MJXW4)',sku:'MJXW4'};
test('copy uses the requested three line format without SKU or links',()=>{
 const phone={...p,model:'18 Pro',storage:'256GB',color:'Black',price:'90000'};
 const jabko={...phone,store:'Jabko',price:'90045'};
 assert.equal(copyPrices([jabko,phone],'45'),'iPhone 18 pro 256 GB Black\nсайт $2000 90000грн\nябко $2001 90045грн');
});
test('copy refuses missing rate and mixed variants',()=>{
 assert.throws(()=>copyPrices([named],null),/курс/);
 assert.throws(()=>copyPrices([named,{...named,sim:'esim'}],'42'),/конфигурацию/);
});
test('copy skips absent prices and works without SKU',()=>{
 assert.equal(copyPrices([{...named,sku:null},{...named,store:'Jabko',price:null}],'45.30'),'iPhone 18 pro Max 512 GB Glacier Blue\nсайт $1950 88335грн');
});
