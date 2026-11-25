import {reserveStockRequest,stockCooldown,stockRetryDelay} from './stock-rate-limit';
import {requireStockIntegration} from './stock-integration';
import {env} from 'cloudflare:workers';
import {db} from './auth';
import {readStockRows} from './moysklad-report.ts';
import {stockWarehouses,type StockRow} from './warehouse-stock.ts';
// Shared request slots keep different models and visitors within the provider limit.
export async function stockRequest(url:string,token:string,options:{method?:string;body?:string;lightAssortment?:boolean}={}){
 requireStockIntegration();
 const d=db(),deadline=Date.now()+45000;
 for(let attempt=0;attempt<3;attempt++){
  let acquired:string|null=null,claim=crypto.randomUUID();
  while(!acquired){
   for(let slot=0;slot<3;slot++){
    const id='moy-api-slot:'+slot,now=Date.now();
    await d.prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(id,'{}','',new Date().toISOString()).run();
    const r=await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND lease<=?').bind(now+90000,claim,id,now).run();if(r.meta.changes){acquired=id;break;}
   }
   if(!acquired){if(Date.now()>deadline)throw Error('Stock provider busy');await new Promise(r=>setTimeout(r,500));}
  }
  let retry=1000;
  try{
   await reserveStockRequest(url,deadline);
   const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8','Accept-Encoding':'gzip',...(options.lightAssortment?{'X-Lognex-Remap-Beta-Feature':'assortmentWithoutStock'}:{}),...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(25000)});
   if(response.status===429||response.status>=500){retry=stockRetryDelay(response.headers);await stockCooldown(retry);await response.body?.cancel();if(attempt===2)throw Error('Stock provider HTTP '+response.status);}
   else{if(response.headers.get('X-RateLimit-Remaining')!==null&&Number(response.headers.get('X-RateLimit-Remaining'))<5)await stockCooldown(Math.min(60000,Math.max(3000,Number(response.headers.get('X-Lognex-Reset'))||0)));if(!response.ok){const detail:any=await response.json().catch(()=>({})),code=Number(detail.errors?.[0]?.code);throw Error('Stock provider HTTP '+response.status+(Number.isSafeInteger(code)?' (code '+code+')':''));}return await response.json();}
  }finally{await d.prepare('UPDATE cloud_refresh SET lease=0,token=? WHERE id=? AND token=?').bind('',acquired,claim).run();}
  await new Promise(r=>setTimeout(r,retry));
 }
 throw Error('Stock provider unavailable');
}
const pending=new Map<string,Promise<{rows:StockRow[];checkedAt:string}|null>>();
type Snapshot={rows:StockRow[];checkedAt:string};
export async function warehouseReport(search:string,index:number,force=false):Promise<Snapshot|null>{
 const id='moy-stock-v1:'+stockWarehouses[index].id+':'+search;
 const existing=pending.get(id);if(existing)return existing;
 const task=loadReport(id,search,index,force);pending.set(id,task);try{return await task;}finally{pending.delete(id);}
}
async function loadReport(id:string,search:string,index:number,force:boolean):Promise<Snapshot|null>{
 const d=db(),saved=await d.prepare('SELECT payload FROM snapshots WHERE id=?').bind(id).first<{payload:string}>();const old:Snapshot|null=saved?JSON.parse(saved.payload):null;
 if(old&&Date.now()-Date.parse(old.checkedAt)<(force?15000:60000))return old;
 const token=(env as any).MOYSKLAD_TOKEN;if(!token){console.error('MoySklad stock: missing server secret');return null;}
 const now=Date.now(),leaseId='lease:'+id,leaseToken=crypto.randomUUID();
 await d.prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(leaseId,'{}','',new Date().toISOString()).run();
 const lock=await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND lease<?').bind(now+90000,leaseToken,leaseId,now).run();
 if(!lock.meta.changes)return old&&now-Date.parse(old.checkedAt)<300000?old:null;
 try{
  const rows=await readStockRows(search,index,url=>stockRequest(url,token));
  const result={rows,checkedAt:new Date().toISOString()};
  await d.prepare('INSERT INTO snapshots(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(id,JSON.stringify(result),result.checkedAt).run();return result;
 }catch(error){console.error('MoySklad stock refresh failed',index,error instanceof Error?error.message:'unknown');return null;}finally{await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND token=?').bind(Date.now()+15000,'',leaseId,leaseToken).run();}
}

export async function cachedWarehouseReport(search:string,index:number):Promise<Snapshot|null>{
 const row=await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind('moy-stock-v1:'+stockWarehouses[index].id+':'+search).first<{payload:string}>();return row?JSON.parse(row.payload):null;
}
export function liveStockReport(ids:string[],index:number){
 const token=(env as any).MOYSKLAD_TOKEN;if(!token)throw Error('Stock provider unavailable');
 return readStockRows('',index,url=>stockRequest(url,token),ids);
}
