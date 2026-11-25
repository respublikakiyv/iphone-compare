import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {telegramIdentity} from '../lib/telegram.ts';
const token='123456:TEST_ONLY';
function signed(entries){const p=new URLSearchParams(entries);const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return p.toString();}
test('valid Telegram session',async()=>assert.equal(await telegramIdentity(signed({user:JSON.stringify({id:123}),auth_date:'1000000'}),token,1000010),'telegram:123'));
test('tampered user rejected',async()=>{const p=new URLSearchParams(signed({user:JSON.stringify({id:123}),auth_date:'1000000'}));p.set('user',JSON.stringify({id:999}));await assert.rejects(telegramIdentity(p.toString(),token,1000010));});
test('expired signature rejected',async()=>assert.rejects(telegramIdentity(signed({user:JSON.stringify({id:123}),auth_date:'1000000'}),token,1200000)));
test('future date rejected',async()=>assert.rejects(telegramIdentity(signed({user:JSON.stringify({id:123}),auth_date:'1200000'}),token,1000000)));
test('empty init data rejected',async()=>assert.rejects(telegramIdentity('',token)));
test('duplicate fields rejected',async()=>{const p=new URLSearchParams(signed({user:JSON.stringify({id:123}),auth_date:'1000000'}));p.append('user','{}');await assert.rejects(telegramIdentity(p.toString(),token,1000010));});
