import {scheduledStockSync} from '../../lib/stock-webhook';
import {identity,json} from '../../lib/auth';
import {cloudJob,publicJob,enqueueRefresh,runRefreshStep,sharedRate,cloudCatalog} from '../../lib/cloud-refresh';
import {appleCategories} from '../../lib/apple-products';
import {allStores,primaryStores} from '../../lib/stores';
const tools=[
 {name:"stock_sync",description:"Synchronize saved Apple stock in the three configured warehouses using changed quantities; reconcile mapping and full counts daily. Drains durable stock webhook notifications. Does not alter prices or send messages.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:'catalog_status',description:'Read the shared Apple catalog refresh status and counts. No customer or account data.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'refresh_prices',description:'Queue one bounded refresh of prices from saved product URLs, or discover the catalog. Reuses an existing active job. No messages are sent.',inputSchema:{type:'object',properties:{retryOnly:{type:'boolean',description:'Retry only failed price cards, keeping fresh successful observations.'},kind:{type:'string',enum:['prices','catalog']},scope:{type:'string',enum:['new','used','all']},category:{type:'string',enum:['all',...appleCategories]},stores:{type:'array',items:{type:'string',enum:allStores},maxItems:6}},additionalProperties:false}},
 {name:'continue_refresh',description:'Process a bounded batch of the queued refresh and persist its checkpoint. Call again while status is queued/running. Jobs survive closing the browser.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
export async function POST(request:Request){let id:any=null;try{const text=await request.text();if(text.length>8000)return json({error:'Too large'},413);const rpc=JSON.parse(text);id=rpc.id??null;const reply=(result:any)=>json({jsonrpc:'2.0',id,result});
 if(rpc.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(rpc.method==='initialize')return reply({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Apple Compare',version:'1.0.0'}});
 if(rpc.method==='notifications/initialized')return new Response(null,{status:204});
 if(rpc.method==='tools/list')return reply({tools});
 const user=await identity(request);if(rpc.method!=='tools/call')throw Error('Unknown method');let result:any;
 switch(rpc.params?.name){
 case 'stock_sync':result=await scheduledStockSync(new URL(request.url).origin);break;
 case 'catalog_status':{const catalog=await cloudCatalog();result={job:publicJob(await cloudJob()),products:catalog.products.length,updated_at:catalog.updated_at,stores:catalog.stores};break;}
 case 'refresh_prices':{const args=rpc.params.arguments||{},catalog=await cloudCatalog();const stores=[...new Set([...primaryStores,...catalog.products.map(p=>p.store).filter(s=>allStores.includes(s))])];const job=await enqueueRefresh(user,args.kind||'prices',args.stores||stores,args.scope||'all',args.category||'all',args.retryOnly??false);await sharedRate();result={job:publicJob(job)};break;}
 case 'continue_refresh':result=await runRefreshStep();break;
 default:throw Error('Unknown tool');}
 return reply({content:[{type:'text',text:JSON.stringify(result)}]});
 }catch(e:any){return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:e.message}],isError:true}});}}
