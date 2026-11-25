import {stockRequest} from './moysklad';
import {stockAutomaticPaused} from './stock-integration';
import {env} from 'cloudflare:workers';
import {db} from './auth';
import {stockSnapshot,putStockSnapshot,syncStock} from './stock-sync';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function webhookKey(request:Request){const secret=(env as any).MOYSKLAD_WEBHOOK_SECRET;return typeof secret==='string'&&secret.length>=32&&(request.headers.get('X-Stock-Webhook-Key')||new URL(request.url).searchParams.get('key'))===secret;}
export async function queueStockEvent(request:Request){
 if(!webhookKey(request))return 403;
 if(stockAutomaticPaused())return 204;
 const config=await stockSnapshot<{accountId:string}>('stock-webhook-config');if(!config)return 503;
 const text=await request.text();if(text.length>12000)return 413;
 let body:any;try{body=JSON.parse(text);}catch{return 400;}
 const id=new URL(request.url).searchParams.get('requestId');if(!id||!uuid.test(id)||body.accountId!==config.accountId||body.reportType!=='bystore'||body.stockType!=='stock')return 400;
 // Never fetch the supplied reportUrl. Only the fixed, filtered provider endpoint is trusted.
 const now=new Date().toISOString();await db().prepare('INSERT OR IGNORE INTO snapshots(id,payload,updated) VALUES(?,?,?)').bind('stock-event:'+id,JSON.stringify({done:false}),now).run();return 204;
}
export async function drainStockEvents(){
 if(stockAutomaticPaused())return {paused:true,pending:0};
 const events=await db().prepare("SELECT id FROM snapshots WHERE id LIKE 'stock-event:%' AND json_extract(payload,'$.done')=0 LIMIT 100").all<{id:string}>();if(!events.results.length)return {pending:0};
 await new Promise(r=>setTimeout(r,1500));
 const result=await syncStock('all',false,2000);if(!result.busy&&!result.partial&&!result.paused&&!result.throttled){const now=new Date().toISOString();await db().batch(events.results.map(e=>db().prepare('UPDATE snapshots SET payload=?,updated=? WHERE id=?').bind('{"done":true}',now,e.id)));await db().prepare("DELETE FROM snapshots WHERE id LIKE 'stock-event:%' AND json_extract(payload,'$.done')=1 AND updated<?").bind(new Date(Date.now()-172800000).toISOString()).run();}
 return result;
}
export async function scheduledStockSync(origin?:string){
 if(stockAutomaticPaused())return {paused:true,requests:0,partial:false};
 const webhook=origin?await ensureStockWebhook(origin).catch((error:any)=>({registered:false,error:error.message})):undefined;
 const metadata=await stockSnapshot<{checkedAt:string}>('stock-assortment-map'),discover=!metadata||Date.now()-Date.parse(metadata.checkedAt)>20*3600000;
 const result=await syncStock('all',discover);if(discover&&!result.busy&&!result.partial)await putStockSnapshot('stock-metadata-checkpoint',{at:new Date().toISOString()});
 await drainStockEvents();return {...result,...(webhook?{webhook}:{})};
}

// Visitors only wake a shared, throttled updater; never one provider request per card.
export async function reconcileOpenStock(){
 if(stockAutomaticPaused())return {paused:true};
 const events=await db().prepare("SELECT id FROM snapshots WHERE id LIKE 'stock-event:%' AND json_extract(payload,'$.done')=0 LIMIT 1").first();
 return events?drainStockEvents():syncStock('all',false,60000);
}
export async function ensureStockWebhook(origin:string){
 if(stockAutomaticPaused())return {paused:true,registered:false};
 const secret=(env as any).MOYSKLAD_WEBHOOK_SECRET,token=(env as any).MOYSKLAD_TOKEN;
 if(typeof secret!=='string'||secret.length<32||!token)throw Error('Webhook secret unavailable');
 const base=new URL(origin);if(base.protocol!=='https:')throw Error('HTTPS required');
 const existing=await stockSnapshot<{id:string;enabled:boolean;checkedAt?:string;origin?:string}>('stock-webhook-config');
 if(existing?.enabled&&existing.origin===base.origin&&existing.checkedAt&&Date.now()-Date.parse(existing.checkedAt)<20*3600000)return {registered:true,enabled:true};
 const d=db(),claim=crypto.randomUUID(),id='stock-webhook-registration',now=Date.now();
 await d.prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(id,'{}','',new Date().toISOString()).run();
 const lock=await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND lease<=?').bind(now+120000,claim,id,now).run();if(!lock.meta.changes)return {registered:!!existing?.enabled,busy:true};
 try{
 const endpoint='https://api.moysklad.ru/api/remap/1.2/entity/webhookstock',url=base.origin+'/api/stock/webhook?key='+encodeURIComponent(secret);
 const data:any=await stockRequest(endpoint,token);if(!Array.isArray(data.rows))throw Error('Invalid webhook list');
 let hook=data.rows.find((r:any)=>r.url===url&&r.reportType==='bystore'&&r.stockType==='stock');
 if(!hook)hook=await stockRequest(endpoint,token,{method:'POST',body:JSON.stringify({url,enabled:true,reportType:'bystore',stockType:'stock'})});
 else if(!hook.enabled){if(!uuid.test(hook.id))throw Error('Invalid webhook ID');hook=await stockRequest(endpoint+'/'+hook.id,token,{method:'PUT',body:JSON.stringify({enabled:true})});}
 if(!uuid.test(hook.id)||!uuid.test(hook.accountId)||hook.enabled!==true)throw Error('Invalid webhook configuration');
 await putStockSnapshot('stock-webhook-config',{id:hook.id,accountId:hook.accountId,enabled:true,origin:base.origin,checkedAt:new Date().toISOString()});return {registered:true,enabled:true};
 }finally{await d.prepare('UPDATE cloud_refresh SET lease=0,token=? WHERE id=? AND token=?').bind('',id,claim).run();}
}
