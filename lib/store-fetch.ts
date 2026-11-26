import {isSourceChallenge} from './source-access.ts';
import {db} from './auth';
import {hosts,safeUrl} from './store-parser';
import {robotsRules,permitted} from './crawl-policy';
export class StoreFailure extends Error {reason:string;code:number;retryAfter:number;stage:string|null;constructor(reason:string,code=502,retryAfter=0,stage:string|null=null){super(reason);this.reason=reason;this.code=code;this.retryAfter=retryAfter;this.stage=stage;}}
async function textFetch(url:string,store:string,policy?:ReturnType<typeof robotsRules>,depth=0,signal=AbortSignal.timeout(15000)):Promise<string>{
 safeUrl(url,store);if(depth&&policy){let acquired=false;for(let attempt=0;attempt<20;attempt++){signal.throwIfAborted();const reserved=await db().prepare('UPDATE crawl_policy SET next_at=? WHERE store=? AND next_at<=?').bind(Date.now()+policy.delay,store,Date.now()).run();if(reserved.meta.changes){acquired=true;break;}const slot=await db().prepare('SELECT next_at FROM crawl_policy WHERE store=?').bind(store).first<any>();await new Promise(resolve=>setTimeout(resolve,Math.min(3000,Math.max(100,Number(slot?.next_at||0)-Date.now()+50))));}if(!acquired)throw new StoreFailure('crawl_busy',429,Math.ceil(policy.delay/1000));}if(policy&&!permitted(url,policy.rules))throw new StoreFailure('robots_denied',403);
 const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'PriceComparisonBot/3.0','Accept-Language':'uk-UA,uk;q=0.9'},signal});
 if(isSourceChallenge(r.headers))throw new StoreFailure('source_challenge',502,0,policy?'page':'robots');
 if([301,302,303,307,308].includes(r.status)){if(depth>=4)throw new StoreFailure('redirect_limit');return textFetch(safeUrl(r.headers.get('location')||'',store,url),store,policy,depth+1,signal);}
 if(r.status===404&&!policy)return '';
 if(r.status!==200)throw new StoreFailure('http_'+r.status,r.status===404?404:502);
 if(Number(r.headers.get('content-length')||0)>5000000)throw new StoreFailure('response_too_large');
 const reader=r.body?.getReader();if(!reader)return '';let size=0;const chunks:Uint8Array[]=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5000000){await reader.cancel();throw new StoreFailure('response_too_large');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const html=new TextDecoder().decode(bytes);if(isSourceChallenge(r.headers,html))throw new StoreFailure('source_challenge',502,0,policy?'page':'robots');return html;
}
async function reserve(store:string,delay:number){
 // Never hold a Worker open while respecting a retailer's crawl delay. The
 // refresh queue persists the item and continues with other stores instead.
 const d=db(),now=Date.now();
 const reserved=await d.prepare('UPDATE crawl_policy SET next_at=? WHERE store=? AND next_at<=?').bind(now+Math.max(delay,1000),store,now).run();
 if(reserved.meta.changes)return;
 const slot=await d.prepare('SELECT next_at FROM crawl_policy WHERE store=?').bind(store).first<any>();
 const wait=Math.max(10,Number(slot?.next_at||0)-Date.now()+10);
 throw new StoreFailure('crawl_busy',429,Math.ceil(wait/1000));
}
export async function storePage(store:string,url:string){
 safeUrl(url,store);const d=db();await d.prepare('CREATE TABLE IF NOT EXISTS crawl_policy(store TEXT PRIMARY KEY,payload TEXT,expires INTEGER,next_at INTEGER NOT NULL DEFAULT 0)').run();await d.prepare('INSERT OR IGNORE INTO crawl_policy(store,next_at) VALUES(?,0)').bind(store).run();
 const cached=await d.prepare('SELECT payload,expires FROM crawl_policy WHERE store=?').bind(store).first<any>();let policy:ReturnType<typeof robotsRules>;
 if(cached?.payload&&cached.expires>Date.now())policy=JSON.parse(cached.payload);
 else{
  const reservation=await d.prepare('UPDATE crawl_policy SET next_at=? WHERE store=? AND next_at<=?').bind(Date.now()+15000,store,Date.now()).run();
  if(!reservation.meta.changes)throw new StoreFailure('crawl_busy',429,3);
  const robots=await textFetch('https://'+hosts[store]+'/robots.txt',store);if(robots.trim().startsWith('<'))throw new StoreFailure('robots_unavailable');policy=robotsRules(robots);
  await d.prepare('UPDATE crawl_policy SET payload=?,expires=?,next_at=? WHERE store=?').bind(JSON.stringify(policy),Date.now()+3600000,Date.now()+policy.delay,store).run();
 }
 if(policy.delay>30000)throw new StoreFailure('crawl_delay_too_long');if(!permitted(url,policy.rules))throw new StoreFailure('robots_denied',403);
 await reserve(store,policy.delay);return textFetch(url,store,policy);
}
