import {db} from './auth';
import {hasPrice,type Product} from './catalog.ts';
import {variantKey} from './apple-products.ts';
export type PricePoint={at:string;price:number};
export async function historyId(p:Product){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([p.store,p.url,variantKey(p),p.edition||'Standard',p.model,p.storage,p.sim,p.color])));return 'price-history:'+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
export function mergePricePoints(points:PricePoint[],products:Product[]){
 const result=[...points];for(const p of products){const at=p.last_success_at||p.checked_at;if(!hasPrice(p)||!at||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()+300000)continue;const last=result.at(-1);if(last&&Date.parse(at)<=Date.parse(last.at)||last?.price===Number(p.price))continue;result.push({at,price:Number(p.price)});}return result.slice(-500);
}
export async function readPriceHistory(p:Product){const row=await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind(await historyId(p)).first<{payload:string}>();return mergePricePoints(row?JSON.parse(row.payload):[],[p]);}
// Included in the catalog transaction and guarded by the same refresh lease.
export async function priceHistoryStatements(before:Product[],after:Product[],token:string,leaseId='active'){
 const old=new Map(before.map(p=>[p.store+'|'+p.url,p])),changed=after.filter(p=>{const b=old.get(p.store+'|'+p.url);return hasPrice(p)&&(!b||p.price!==b.price||p.last_success_at!==b.last_success_at);}),ids=await Promise.all(changed.map(historyId)),saved=new Map<string,PricePoint[]>(),d=db();
 for(let i=0;i<ids.length;i+=80){const part=ids.slice(i,i+80);const rows=await d.prepare('SELECT id,payload FROM snapshots WHERE id IN ('+part.map(()=>'?').join(',')+')').bind(...part).all<{id:string;payload:string}>();for(const row of rows.results)saved.set(row.id,JSON.parse(row.payload));}
 return changed.flatMap((p,i)=>{const b=old.get(p.store+'|'+p.url),points=saved.get(ids[i])||[],next=mergePricePoints(points,[...(b&&JSON.stringify([b.model,b.storage,b.sim,b.color,b.edition,b.variant_key])===JSON.stringify([p.model,p.storage,p.sim,p.color,p.edition,p.variant_key])?[b]:[]),p]);if(!next.length||JSON.stringify(points)===JSON.stringify(next))return [];return [d.prepare('INSERT INTO snapshots(id,payload,updated) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM cloud_refresh WHERE id=? AND token=?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(ids[i],JSON.stringify(next),new Date().toISOString(),leaseId,token)];});
}
