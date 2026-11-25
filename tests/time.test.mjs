import test from 'node:test';
import assert from 'node:assert/strict';
import {formatKyivDate,formatPriceDate,timestampMillis,futureTimestamp} from '../lib/time.ts';
import {repairDeviceTimes,needsTimeRepair} from '../lib/device-catalog.ts';

const now=Date.parse('2026-10-14T16:54:00Z');
const p={store:'iPeople',url:'https://ipeople.ua/p',model:'18 Pro',storage:'256GB',sim:'physical',color:'Black',edition:'Standard',price:'90000',status:'ok',checked_at:'2026-10-14T20:26:00Z',last_success_at:'2026-10-14T20:26:00Z'};

test('Kyiv time is independent of the runtime timezone and uses 24 hours',()=>{
 const before=process.env.TZ;
 try{
  for(const tz of ['UTC','America/Fortaleza','Asia/Tokyo']){
   process.env.TZ=tz;
   assert.match(formatKyivDate('2026-10-14T16:53:00Z',now),/19:53$/);
   assert.equal(formatKyivDate('2026-10-14T19:53:00+03:00',now),formatKyivDate('2026-10-14T16:53:00Z',now));
  }
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('Kyiv formatting respects daylight saving time',()=>{
 assert.match(formatKyivDate('2026-01-14T16:00:00Z',now),/18:00$/);
 assert.match(formatKyivDate('2026-07-14T16:00:00Z',now),/19:00$/);
 assert.match(formatKyivDate('2026-06-30T22:30:00Z',now),/^1 .*01:30$/);
});

test('microsecond ISO snapshots normalize for Safari; missing, ambiguous and future dates are hidden',()=>{
 assert.equal(timestampMillis('2026-10-14T16:53:00.123456+00:00'),Date.parse('2026-10-14T16:53:00.123Z'));
 assert.equal(formatKyivDate('2026-10-14T16:53:00.123456+00:00',now),formatKyivDate('2026-10-14T16:53:00.123Z',now));
 for(const value of [null,'','bad','2026-10-14T16:53:00','2026-10-14T20:00:00Z'])assert.equal(formatKyivDate(value,now),null);
 assert.equal(futureTimestamp(p.checked_at,now),true);
});

test('future cached records recover only from verified matching offers and preserve local rate and job',()=>{
 const state={catalog:{products:[p],stores:{},updated_at:p.checked_at},rate:'45',job:{status:'partial'}};
 const fresh={...p,price:'91000',checked_at:'2026-10-14T16:53:00Z',last_success_at:'2026-10-14T16:53:00Z'};
 const verified={products:[fresh],stores:{},updated_at:fresh.checked_at};
 assert.equal(needsTimeRepair(state.catalog,now),true);
 const next=repairDeviceTimes(state,verified,now);
 assert.equal(next.catalog.products[0].checked_at,fresh.checked_at);assert.equal(next.catalog.products[0].price,fresh.price);
 assert.equal(next.catalog.updated_at,verified.updated_at);assert.equal(next.rate,'45');assert.equal(next.job,state.job);
 assert.equal(needsTimeRepair(next.catalog,now),false);
 assert.equal(state.catalog.products[0].checked_at,p.checked_at);
});

test('repair cannot mix SIM or used/new offers, trust another future date or overwrite valid local prices',()=>{
 const state={catalog:{products:[p],stores:{}},rate:'45',job:null};
 const fresh={...p,checked_at:'2026-10-14T16:53:00Z',last_success_at:'2026-10-14T16:53:00Z'};
 for(const change of [{sim:'esim'},{edition:'Used'},{color:'White'},{status:'error'},{price:null},{checked_at:p.checked_at},{last_success_at:p.last_success_at}]){
  assert.equal(repairDeviceTimes(state,{products:[{...fresh,...change}],stores:{}},now).catalog.products[0],p);
 }
 const valid={...fresh,price:'92000'};
 assert.equal(repairDeviceTimes({...state,catalog:{products:[valid],stores:{}}},{products:[fresh],stores:{}},now).catalog.products[0],valid);
 const historical={...valid,status:'error',checked_at:p.checked_at};
 assert.equal(needsTimeRepair({products:[historical],stores:{}},now),false);
 assert.equal(repairDeviceTimes({...state,catalog:{products:[historical],stores:{}}},{products:[fresh],stores:{}},now).catalog.products[0],historical);
});

test('price date uses numeric day/month and unpadded Kyiv hour',()=>{
 const current=Date.parse('2026-10-15T09:00:00Z');
 assert.equal(formatPriceDate('2026-10-15T06:33:00Z',current),'15.10 9:33');
 assert.equal(formatPriceDate('2026-09-15T06:03:00Z',current),'15.09 9:03');
 assert.equal(formatPriceDate('2026-06-30T22:30:00Z',current),'01.07 1:30');
 assert.equal(formatPriceDate('2026-01-15T07:33:00Z',current),'15.01 9:33');
 for(const value of [null,'bad','2026-10-15T12:00:00Z'])assert.equal(formatPriceDate(value,current),null);
});
