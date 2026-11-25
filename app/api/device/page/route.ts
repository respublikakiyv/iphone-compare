import {allStores} from '../../../../lib/stores';
import {identity,internal,json,failure} from '../../../../lib/auth';
import {parsePage,safeUrl} from '../../../../lib/store-parser';
import {storePage,StoreFailure} from '../../../../lib/store-fetch';
export async function POST(request:Request){try{
 if(request.headers.has('X-Sync-Key'))internal(request);else await identity(request);
 const text=await request.text();if(text.length>2500)return json({error:'Request too large'},413);const {store,url,scope='new'}=JSON.parse(text);if(!['new','used'].includes(scope)||(scope==='used'&&store!=='iPeople'))return json({error:'Invalid inventory'},400);if(typeof url!=='string'||!allStores.includes(store))return json({error:'Invalid request'},400);
 let target:string;try{target=safeUrl(url,store);}catch{return json({error:'Invalid URL'},400);}
 const html=await storePage(store,target);return json(parsePage(store,html,target,scope));
 }catch(e){if(e instanceof StoreFailure)return json({error:e.reason,retryAfter:e.retryAfter,stage:e.stage},e.code);return failure(e);}}
