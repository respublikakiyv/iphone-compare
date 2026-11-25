import type {Inventory} from './inventory.ts';
export function abortablePause(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(signal.reason||new Error('Обновление остановлено'));return;}
 const stop=()=>{clearTimeout(timer);reject(signal.reason||new Error('Обновление остановлено'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});
});}
// One sequential reader per source; retry transport/server faults, never hammer a blocked source.
export function createPageReader(scope:Inventory,signal:AbortSignal,initData:()=>string,options:{fetch?:typeof fetch;pause?:typeof abortablePause}={}){
 const request=options.fetch||fetch,pause=options.pause||abortablePause;
 return async(store:string,url:string)=>{
  let retries=0,waits=0;
  for(;;){
   signal.throwIfAborted();let response:Response,payload:any;
   try{
    response=await request('/api/device/page',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData()},body:JSON.stringify({store,url,scope}),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
    try{payload=await response.json();}catch{payload={error:'invalid_response'};}
   }catch(e){signal.throwIfAborted();if(retries++>=2)throw new Error('network_error');await pause(500*2**(retries-1),signal);continue;}
   if(response.status===429&&payload.error==='crawl_busy'&&waits++<40){await pause(Math.max(100,Math.min(30000,Number(payload.retryAfter||1)*1000)),signal);continue;}
   if(response.ok&&payload.error!=='invalid_response')return payload;
   const permanent=['http_403','http_429','http_404','robots_denied','source_challenge','crawl_delay_too_long','response_too_large','foreign_url','redirect_limit'].includes(payload.error);
   if(!permanent&&(response.status>=500||payload.error==='invalid_response')&&retries++<2){await pause(500*2**(retries-1),signal);continue;}
   throw new Error(payload.error||'Ошибка загрузки');
  }
 };
}
