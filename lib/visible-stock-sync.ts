type Options={request:(version:string|undefined,signal:AbortSignal)=>Promise<any>;onData:(data:any)=>void;onError:()=>void;visible:()=>boolean;subscribe:(listener:()=>void)=>()=>void;schedule?:(fn:()=>void,ms:number)=>any;cancel?:(timer:any)=>void};
export function startVisibleStockSync(o:Options){
 const schedule=o.schedule||setTimeout,cancel=o.cancel||clearTimeout;let stopped=false,epoch=0,timer:any,controller:AbortController|null=null,version:string|undefined;
 const clear=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
 async function tick(){
  if(stopped||!o.visible())return;const turn=epoch;controller=new AbortController();const signal=controller.signal;let interval=10000;
  try{const data=await o.request(version,signal);if(stopped||turn!==epoch||signal.aborted||!o.visible())return;o.onData(data);version=data.version;interval=data.onOpen===true?0:data.realtime===true?10000:60000;}
  catch{if(!stopped&&turn===epoch&&!signal.aborted)o.onError();}
  finally{if(!stopped&&turn===epoch&&o.visible()&&interval>0)timer=schedule(()=>void tick(),interval);}
 }
 const wake=()=>{epoch++;clear();controller?.abort();if(o.visible())void tick();};const unsubscribe=o.subscribe(wake);void tick();
 return()=>{stopped=true;epoch++;clear();controller?.abort();unsubscribe();};
}
