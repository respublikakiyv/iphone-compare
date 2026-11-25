import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
register('./cloudflare-test-loader.mjs',import.meta.url);
const sql=new DatabaseSync(':memory:');for(const name of ['0000_clumsy_blockbuster.sql','0001_serious_arclight.sql'])sql.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
let queries=[],beforePayload=null;
function prepare(q){const stmt=sql.prepare(q);let args=[];return {bind(...v){args=v;return this;},async first(){queries.push({q,args});if(q==='SELECT payload,updated FROM snapshots WHERE id=?'&&args[0]==='catalog'&&beforePayload){const callback=beforePayload;beforePayload=null;callback();}return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}
globalThis.__testCloudflareEnv={DB:{prepare}};
const {GET}=await import('../app/api/state/route.ts'),{GET:progress}=await import('../app/api/progress/route.ts');
const catalog={products:[{model:'17',price:'45000'}],stores:{},updated_at:'2026-10-20T10:00:00Z'};
const save=(version,payload=JSON.stringify(catalog))=>sql.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)').run('catalog',payload,version);
function reset(){sql.exec('DELETE FROM snapshots;DELETE FROM preferences;DELETE FROM cloud_refresh');queries=[];beforePayload=null;save('v1');}
test('same catalog version returns only metadata without reading or decoding the payload',async()=>{
 reset();save('v1','invalid JSON proves payload was not parsed');const response=await GET(new Request('https://example.test/api/state?version=v1'));assert.equal(response.status,200);const data=await response.json();assert.equal(data.catalogUnchanged,true);assert.equal(data.catalogVersion,'v1');assert.equal(data.catalog,undefined);assert.equal(queries.some(r=>r.args[0]==='catalog'&&r.q.includes('payload')),false);
});
test('new and legacy clients receive the full catalog with its matching version',async()=>{
 reset();for(const url of ['https://example.test/api/state','https://example.test/api/state?version=old']){const data=await(await GET(new Request(url))).json();assert.deepEqual(data.catalog,catalog);assert.equal(data.catalogVersion,'v1');}
});
test('progress is separate, includes rate/job changes, and never reads the catalog payload',async()=>{
 reset();sql.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('exchange-rate',JSON.stringify({rate:'45.2',source:'iPeople',checked_at:'2026-10-20T11:00:00Z'}),'x');sql.prepare('INSERT INTO cloud_refresh VALUES(?,?,?,?,?)').run('active',JSON.stringify({id:'job',status:'running',progress:50,sources:[],requestedBy:'private'}),0,'','x');const data=await(await progress(new Request('https://example.test/api/progress'))).json();assert.equal(data.catalogVersion,'v1');assert.equal(data.catalog,undefined);assert.equal(data.rate,'45.2');assert.equal(data.job.progress,50);assert.equal(data.job.requestedBy,undefined);assert.equal(queries.some(r=>r.args[0]==='catalog'&&r.q.includes('payload')),false);
});
test('a refresh between metadata and payload cannot label a new catalog with the old version',async()=>{
 reset();beforePayload=()=>save('v2',JSON.stringify({...catalog,products:[{model:'18'}]}));const data=await(await GET(new Request('https://example.test/api/state?version=old'))).json();assert.equal(data.catalogVersion,'v2');assert.equal(data.catalog.products[0].model,'18');
});
test('Open Box updates invalidate the version and overlay the shared catalog',async()=>{reset();sql.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('open-box-catalog',JSON.stringify({products:[{model:'MacBook Air 15',edition:'OpenBox'}]}),'open-v1');const r=await(await GET(new Request('https://example.test/api/state?version=v1'))).json();assert.equal(r.catalogVersion,'v1|open-v1|open-box-100-v1');assert.equal(r.catalog.products.length,2);const cached=await(await GET(new Request('https://example.test/api/state?version='+encodeURIComponent(r.catalogVersion)))).json();assert.equal(cached.catalogUnchanged,true);});
