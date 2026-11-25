import test from 'node:test';import assert from 'node:assert/strict';
import {availableUsedOffers} from '../lib/used-offers.ts';
import {stockProductKey} from '../lib/warehouse-stock.ts';
const p={store:'iPeople',url:'https://ipeople.ua/used17',model:'17',storage:'256GB',sim:'physical',color:'Black',edition:'Used',price:'35000',status:'ok',checked_at:''};
const stock=(p,value)=>({[stockProductKey(p)]:value});
test('used list includes all models and capacities in any selected warehouse',()=>{
 const a={...p,url:'https://ipeople.ua/used13',model:'13',storage:'128GB'},b={...p,url:'https://ipeople.ua/used15',model:'15 Pro',storage:'512GB'},c={...p,url:'https://ipeople.ua/used16',model:'16',storage:'1TB'};
 const rows=availableUsedOffers([a,b,c,p],{...stock(a,[1,0,0]),...stock(b,[0,2,0]),...stock(c,[0,0,1]),...stock(p,[0,0,0])});
 assert.deepEqual(rows.map(r=>r.iPeople.model),['16','15 Pro','13','17']);assert.match(rows[2].title,/13.*128GB.*Black/);
});
test('zero, missing and unknown stay visible; incompatible offers stay out',()=>{
 for(const value of [[0,0,0],[null,null,null],[-1,0,0]])assert.equal(availableUsedOffers([p],stock(p,value)).length,1);
 assert.equal(availableUsedOffers([p],{}).length,1);
 for(const other of [{...p,sim:'esim'},{...p,sim:'unknown'},{...p,edition:'Standard'},{...p,store:'Jabko'}])assert.equal(availableUsedOffers([other],stock(other,[1,0,0])).length,0);
});
test('search covers every available model, storage and color',()=>{
 const a={...p,url:'https://ipeople.ua/used13',model:'13',storage:'128GB',color:'Pink'};const values={...stock(p,[1,0,0]),...stock(a,[0,1,0])};
 assert.deepEqual(availableUsedOffers([p,a],values,'13 pink').map(r=>r.iPeople),[a]);assert.equal(availableUsedOffers([p,a],values,'256GB').length,1);
});
test('warehouse stock remains authoritative even when website price is unavailable',()=>{
 const other={...p,status:'unavailable',price:null,full_title:'Б/У iPhone 17 256GB Black — Grade A'};
 const result=availableUsedOffers([other],stock(other,[0,0,2]));assert.equal(result.length,1);assert.equal(result[0].title,other.full_title);
});
test('optional model and memory filters narrow the full available used base',()=>{
 const a={...p,url:'https://ipeople.ua/used13',model:'13',storage:'128GB'},b={...p,url:'https://ipeople.ua/used17512',storage:'512GB'};const values={...stock(p,[1,0,0]),...stock(a,[0,1,0]),...stock(b,[0,0,1])};
 assert.equal(availableUsedOffers([p,a,b],values).length,3);
 assert.deepEqual(availableUsedOffers([p,a,b],values,'','17','512GB').map(r=>r.iPeople),[b]);
 assert.deepEqual(availableUsedOffers([p,a,b],values,'','','128GB').map(r=>r.iPeople),[a]);
});
test('used Air with eSIM appears with warehouse stock alongside physical-SIM phones',()=>{
 const air={...p,url:'https://ipeople.ua/used-air',model:'17 Air',color:'Light Gold',sim:'esim'};const values={...stock(air,[1,0,0]),...stock(p,[0,1,0])};assert.equal(availableUsedOffers([air,p],values).length,2);assert.equal(availableUsedOffers([air,p],values,'','17 Air').length,1);
});
