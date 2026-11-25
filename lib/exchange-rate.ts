import {load} from 'cheerio';
import {robotsRules,permitted} from './crawl-policy.ts';
import {isSourceChallenge} from './source-access.ts';
export const RATE_SOURCE='https://www.ipeople.in.ua/';
export type ExchangeRate={rate:string;source:string;checked_at:string};
export function parseExchangeRate(html:string){
 const $=load(html);$('script,style,noscript').remove();
 const values:string[]=[];
 // Read only the visible exchange-rate label in the retailer's top navigation.
 $('.top-navi li').each((_,element)=>{
  const text=$(element).text().replace(/\s+/g,' ').trim();
  const match=/^1\s*\$\s*=\s*(\d+(?:[.,]\d{1,4})?)\s*UAH$/i.exec(text);
  if(match)values.push(match[1].replace(',','.'));
 });
 const rates=[...new Set(values.map(Number))];
 if(rates.length!==1||!Number.isFinite(rates[0])||rates[0]<1||rates[0]>1000)throw Error('rate_not_found');
 return String(rates[0]);
}
async function readText(url:string,signal:AbortSignal){
 const response=await fetch(url,{headers:{'User-Agent':'PriceComparisonBot/3.0','Accept-Language':'uk-UA,uk;q=0.9'},redirect:'manual',cache:'no-store',signal});
 if(!response.ok||isSourceChallenge(response.headers))throw Error('rate_source_unavailable');
 const reader=response.body?.getReader();if(!reader)throw Error('rate_empty');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000){await reader.cancel();throw Error('rate_response_too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const text=new TextDecoder().decode(bytes);if(isSourceChallenge(response.headers,text))throw Error('rate_source_unavailable');return text;
}
let policyCache:{policy:ReturnType<typeof robotsRules>;expires:number}|null=null;
let inFlight:Promise<ExchangeRate>|null=null;
export function fetchExchangeRate():Promise<ExchangeRate>{
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  const signal=AbortSignal.timeout(15000);
  if(!policyCache||policyCache.expires<=Date.now()){
   const robots=await readText(RATE_SOURCE+'robots.txt',signal);
   if(robots.trim().startsWith('<'))throw Error('rate_robots_unavailable');
   const policy=robotsRules(robots);
   if(!permitted(RATE_SOURCE,policy.rules)||policy.delay>10000)throw Error('rate_robots_denied');
   policyCache={policy,expires:Date.now()+3600000};
   await new Promise(resolve=>setTimeout(resolve,policy.delay));signal.throwIfAborted();
  }
  // Coalesce concurrent callers, but obtain a new observation on each later refresh.
  const rate=parseExchangeRate(await readText(RATE_SOURCE,signal));
  return {rate,source:RATE_SOURCE,checked_at:new Date().toISOString()};
 })().finally(()=>{inFlight=null;});
 return inFlight;
}
