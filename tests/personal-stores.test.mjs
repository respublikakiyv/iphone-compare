import test from'node:test';import assert from'node:assert/strict';import{register}from'node:module';import{DatabaseSync}from'node:sqlite';import{createHmac}from'node:crypto';
register('./cloudflare-test-loader.mjs',import.meta.url);
const sql=new DatabaseSync(':memory:'),token='12345:TEST_ONLY';globalThis.__testCloudflareEnv={TELEGRAM_BOT_TOKEN:token,DB:{prepare(query){const statement=sql.prepare(query);let values=[];return {bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};}};}}};
const {GET,POST}=await import('../app/api/my-stores/route.ts');
function headers(id){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id})});const text=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(text).digest('hex'));return {'X-Telegram-Init-Data':p.toString(),'Content-Type':'application/json'};}
const request=(id,body)=>new Request('https://example.test/api/my-stores',{headers:headers(id),method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
test('optional stores default off; account settings cannot change another person or primary defaults',async()=>{
 assert.deepEqual(await (await GET(request(1))).json(),{extraStores:[]});assert.deepEqual(await(await GET(request(2))).json(),{extraStores:[]});
 assert.equal((await POST(request(1,{extraStores:['YA','Comfy'],user_id:'telegram:2',owner:true}))).status,200);
 assert.deepEqual(await(await GET(request(1))).json(),{extraStores:['YA','Comfy']});assert.deepEqual(await(await GET(request(2))).json(),{extraStores:[]});
 for(const value of [['iPeople'],['evil'],['YA','YA'],'Comfy',null])assert.equal((await POST(request(1,{extraStores:value}))).status,400);
 assert.deepEqual(await(await GET(request(1))).json(),{extraStores:['YA','Comfy']});
 const noAuth=await GET(new Request('https://example.test/api/my-stores'));assert.equal(noAuth.status,200);assert.deepEqual(await noAuth.json(),{extraStores:[]});
 const forged=headers(1);forged['X-Telegram-Init-Data']=forged['X-Telegram-Init-Data'].replace('%3A1%7D','%3A2%7D');assert.deepEqual(await(await GET(new Request('https://example.test/api/my-stores',{headers:forged}))).json(),{extraStores:[]});
});

test('iSpace opt-in stays personal; old accounts remain off',async()=>{assert.deepEqual(await(await GET(request(3))).json(),{extraStores:[]});assert.equal((await POST(request(3,{extraStores:['iSpace']}))).status,200);assert.deepEqual(await(await GET(request(3))).json(),{extraStores:['iSpace']});assert.deepEqual(await(await GET(request(4))).json(),{extraStores:[]});});
