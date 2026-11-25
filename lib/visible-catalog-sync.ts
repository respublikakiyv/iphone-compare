type Options={
 request:(path:string,body:unknown,signal:AbortSignal)=>Promise<any>;
 getVersion:()=>string|undefined;
 getJob:()=>any;
 onMetadata:(value:any)=>void;
 onCatalog:(value:any)=>void;
 onStatus:(value:'current'|'offline')=>void;
 visible:()=>boolean;
 subscribe:(listener:()=>void)=>()=>void;
 now?:()=>number;
 schedule?:(callback:()=>void,ms:number)=>any;
 cancel?:(timer:any)=>void;
};
// One loop owns both progress and catalog reads; visibility changes abort its requests.
export function startVisibleCatalogSync(options:Options){
 const now=options.now||Date.now,schedule=options.schedule||setTimeout,cancel=options.cancel||clearTimeout;
 let stopped=false,epoch=0,timer:any=null,controller:AbortController|null=null,lastCatalogRead=0,needsProgress=true;
 const active=(job:any)=>job&&['queued','running'].includes(job.status);
 async function tick(){
  if(stopped||!options.visible())return;
  const turn=epoch;controller=new AbortController();const signal=controller.signal;let wait=30000;
  try{
   const stepping=!needsProgress&&active(options.getJob());needsProgress=false;
   const response=await options.request(stepping?'/api/cloud-step':'/api/progress',stepping?{}:undefined,signal);
   if(stopped||turn!==epoch||signal.aborted||!options.visible())return;
   options.onMetadata(response);
   const terminal=!active(response.job),changed=response.catalogVersion!==options.getVersion();
   if(changed&&(terminal||!stepping||now()-lastCatalogRead>=5000)){
    const version=options.getVersion(),state=await options.request('/api/state'+(version?'?version='+encodeURIComponent(version):''),undefined,signal);
    if(stopped||turn!==epoch||signal.aborted||!options.visible())return;
    lastCatalogRead=now();options.onCatalog(state);
   }
   options.onStatus('current');
   wait=active(response.job)?Math.min(30000,Math.max(1000,response.retryAfterMs|| (response.busy?3000:1000))):30000;
  }catch(error:any){if(error?.name!=='AbortError'&&turn===epoch&&!stopped&&options.visible()){options.onStatus('offline');wait=5000;needsProgress=true;}}
  finally{if(turn===epoch){controller=null;if(!stopped&&options.visible())timer=schedule(()=>void tick(),wait);}}
 }
 function visibility(){epoch++;if(timer!==null)cancel(timer);timer=null;controller?.abort();controller=null;needsProgress=true;if(!stopped&&options.visible())void tick();}
 const unsubscribe=options.subscribe(visibility);if(options.visible())void tick();
 return ()=>{stopped=true;epoch++;if(timer!==null)cancel(timer);controller?.abort();unsubscribe();};
}
