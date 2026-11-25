import {db} from './auth';
export function stockRequestWeight(url:string,now=Date.now()){
 const path=new URL(url).pathname;
 if(/^\/api\/remap\/1\.2\/report\/stock\/(all|bystore)\/?$/.test(path))return 5;
 return now>=Date.parse('2026-12-01T00:00:00+03:00')?4:now>=Date.parse('2026-09-01T00:00:00+03:00')?3:now>=Date.parse('2026-05-12T00:00:00+03:00')?2:1;
}
// One shared weighted queue across visitors and worker instances. Leave 10% headroom.
export async function reserveStockRequest(url:string,deadline:number){
 const d=db(),id='moy-rate-budget';
 await d.prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(id,'{}','',new Date().toISOString()).run();
 for(;;){const now=Date.now();if(now>deadline)throw Error('Stock provider busy');
  const slot=await d.prepare('UPDATE cloud_refresh SET lease=? WHERE id=? AND lease<=?').bind(now+Math.ceil(stockRequestWeight(url,now)*3000/40),id,now).run();if(slot.meta.changes)return;
  const next=await d.prepare('SELECT lease FROM cloud_refresh WHERE id=?').bind(id).first<{lease:number}>();await new Promise(r=>setTimeout(r,Math.min(1000,Math.max(25,(next?.lease||now)-now))));
 }
}
export async function stockCooldown(milliseconds:number){
 await db().prepare('UPDATE cloud_refresh SET lease=max(lease,?) WHERE id=?').bind(Date.now()+milliseconds,'moy-rate-budget').run();
}
export function stockRetryDelay(headers:Headers){
 const raw=headers.get('Retry-After')||'0',numeric=Number(raw),seconds=Number.isFinite(numeric)?numeric*1000:Math.max(0,Date.parse(raw)-Date.now()),value=Number(headers.get('X-Lognex-Retry-After')||0),millis=Number.isFinite(value)?value:0;
 return Math.max(1000,Math.min(60000,Math.max(Number.isFinite(seconds)?seconds:0,millis)));
}
