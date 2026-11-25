import test from'node:test';import assert from'node:assert/strict';import{register}from'node:module';import{DatabaseSync}from'node:sqlite';
register('./cloudflare-test-loader.mjs',import.meta.url);
const sql=new DatabaseSync(':memory:');const env={ADMIN_SETUP_CODE:'test-secret-not-production',DB:{prepare(query){const statement=sql.prepare(query);let values=[];return {bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};}};}}};globalThis.__testCloudflareEnv=env;
const {claimOwner,requireOwner,saveSettings,configuration,publicSettings}=await import('../lib/admin.ts');
test('one-time owner claim and server settings enforce verified Telegram account',async()=>{
 assert.equal(await configuration(),null);
 await assert.rejects(requireOwner('telegram:2'),/Forbidden/);
 await assert.rejects(claimOwner('telegram:2','bad'),/Неверный/);
 await Promise.all([claimOwner('telegram:1',env.ADMIN_SETUP_CODE),assert.rejects(claimOwner('telegram:2','bad'),/Неверный|уже/)]);
 assert.equal((await requireOwner('telegram:1')).owner,'telegram:1');
 await assert.rejects(claimOwner('telegram:2',env.ADMIN_SETUP_CODE),/уже/);
 await assert.rejects(requireOwner('telegram:2'),/Forbidden/);
 const settings=publicSettings(await configuration());assert.equal(settings.owner,undefined);assert.equal(JSON.stringify(settings).includes(env.ADMIN_SETUP_CODE),false);
 await assert.rejects(saveSettings('telegram:2',{...settings,owner:'telegram:2'}),/Forbidden/);
 const saved=await saveSettings('telegram:1',{...settings,bossRecipient:'Gerasim_vlad',staleHours:7});assert.equal(saved.revision,2);
 await assert.rejects(saveSettings('telegram:1',settings),/изменились/);
 assert.equal(publicSettings(await configuration()).staleHours,7);
});

test('legacy owner settings cannot silently make iSpace mandatory',()=>{const row={revision:12,payload:JSON.stringify({stores:['iPeople','Jabko','iSpace'],bossRecipient:'Gerasim_vlad',staleHours:6,defaultRate:'45',showUsed:true})};const migrated=publicSettings(row);assert.deepEqual(migrated.stores,['iPeople','Jabko']);assert.equal(migrated.revision,12);assert.equal(migrated.defaultRate,'45');});
