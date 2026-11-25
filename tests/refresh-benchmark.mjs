// Synthetic I/O benchmark. Does not contact stores or represent production latency.
import {performance} from 'node:perf_hooks';
import {refreshDevice} from '../lib/device-catalog.ts';
const shops=['iPeople','Jabko'];
const products=shops.flatMap(store=>Array.from({length:20},(_,n)=>({store,url:`https://${store==='iPeople'?'ipeople.ua':'jabko.ua'}/benchmark-${n}`,model:'17',storage:'256GB',sim:'physical',edition:'Standard',color:'Black',price:'40000',status:'ok',checked_at:new Date().toISOString(),last_success_at:new Date().toISOString()})));
const initial={products,stores:{}};
const read=async(store,url)=>{await new Promise(resolve=>setTimeout(resolve,20));return {record:products.find(p=>p.store===store&&p.url===url)};};
const run=stores=>refreshDevice('prices',initial,read,()=>{},new AbortController().signal,'new',stores);
const start=performance.now();for(const store of shops)await run([store]);const serialMs=performance.now()-start;
const parallelStart=performance.now();await run(shops);const parallelMs=performance.now()-parallelStart;
console.log(JSON.stringify({requests:40,artificialDelayMs:20,serialMs:Math.round(serialMs),parallelMs:Math.round(parallelMs),speedup:Number((serialMs/parallelMs).toFixed(2)),note:'Synthetic I/O only; production speed depends on store latency, crawl-delay and errors.'},null,2));
