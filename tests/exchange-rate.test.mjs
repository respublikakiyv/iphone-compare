import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {register} from 'node:module';
import {parseExchangeRate,fetchExchangeRate,RATE_SOURCE} from '../lib/exchange-rate.ts';
register('./cloudflare-test-loader.mjs',import.meta.url);
const rateDb=new DatabaseSync(':memory:');rateDb.exec('CREATE TABLE snapshots(id TEXT PRIMARY KEY,payload TEXT,updated TEXT)');
const token='123456:TEST_ONLY';globalThis.__testCloudflareEnv={TELEGRAM_BOT_TOKEN:token,DB:{prepare(q){const stmt=rateDb.prepare(q);let args=[];return {bind(...v){args=v;return this;},async run(){return stmt.run(...args);}};}}};
const {GET}=await import('../app/api/rate/route.ts');
const html=fs.readFileSync(new URL('./fixtures/ipeople-rate.html',import.meta.url),'utf8');
function request(auth=true){
 const p=new URLSearchParams({user:JSON.stringify({id:123}),auth_date:String(Math.floor(Date.now()/1000))});
 const check=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
 return new Request('https://example.test/api/rate',{headers:auth?{'X-Telegram-Init-Data':p.toString()}:undefined});
}
test('reads the exact top-navigation rate, accepts decimal comma and ignores product amounts',()=>{
 assert.equal(parseExchangeRate(html),'45.3');assert.equal(parseExchangeRate(html.replace('45.30','46,25')),'46.25');
 assert.equal(parseExchangeRate(html.replace('999 грн. 22$','1 $ = 99 UAH')),'45.3');
});
test('missing, conflicting, script-only and invalid rates cannot become an observation',()=>{
 for(const content of [html.replace('top-navi','products'),html.replace('45.30','0'),html.replace('45.30','1001'),'<script>1 $ = 45.30 UAH</script>',html.replace('</ul>','<li>1 $ = 46 UAH</li></ul>')])assert.throws(()=>parseExchangeRate(content));
});
test('concurrent refreshes share one request and later refreshes fetch a new rate',async()=>{
 const original=global.fetch,calls=[];let value=html;
 global.fetch=async(url,options)=>{calls.push(String(url));assert.equal(options.redirect,'manual');return new Response(String(url).endsWith('robots.txt')?'User-agent: *\nDisallow: /api/':value);};
 try{
  const first=fetchExchangeRate(),second=fetchExchangeRate();assert.equal(first,second);
  const observation=await first;assert.equal(observation.rate,'45.3');assert.equal(observation.source,RATE_SOURCE);assert.ok(Number.isFinite(Date.parse(observation.checked_at)));
  assert.deepEqual(calls,[RATE_SOURCE+'robots.txt',RATE_SOURCE]);
  value=html.replace('45.30','46.10');const next=await fetchExchangeRate();assert.equal(next.rate,'46.1');assert.equal(calls.at(-1),RATE_SOURCE);assert.equal(calls.length,3);
 }finally{global.fetch=original;}
});
test('rate endpoint works publicly and returns a verified observation',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response(html);};
 try{
  assert.equal((await GET(request(false))).status,200);assert.equal(calls,1);
  const response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const value=await response.json();assert.equal(value.rate,'45.3');assert.equal(value.source,RATE_SOURCE);assert.ok(value.checked_at);
 }finally{global.fetch=original;}
});
test('blocked or malformed source returns an error without a replacement rate; next refresh recovers',async()=>{
 const original=global.fetch;
 try{
  for(const response of [()=>new Response(null,{status:302,headers:{location:'https://example.test/'}}),()=>new Response('blocked',{status:403}),()=>new Response('<title>Just a moment...</title>',{headers:{'cf-mitigated':'challenge'}}),()=>new Response('<div>price: $999</div>')]){
   global.fetch=async()=>response();const result=await GET(request());assert.equal(result.status,502);const body=await result.json();assert.equal(body.rate,undefined);assert.match(body.error,/сохранённый курс/);
  }
  global.fetch=async()=>new Response(html);assert.equal((await fetchExchangeRate()).rate,'45.3');
 }finally{global.fetch=original;}
});
