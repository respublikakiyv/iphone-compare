import {stockAutomaticPaused,stockPausedMessage} from '../../../../lib/stock-integration';
import {json,failure} from '../../../../lib/auth';
import {webhookKey,scheduledStockSync,ensureStockWebhook} from '../../../../lib/stock-webhook';
import {putStockSnapshot,stockSnapshot} from '../../../../lib/stock-sync';
export async function POST(request:Request){try{
 if(!webhookKey(request))return json({error:'Unauthorized'},403);
 const body=await request.json() as any;
 if(body.action==='sync')return json(await scheduledStockSync());
 if(body.action==='status')return json({config:await stockSnapshot('stock-webhook-config'),cursor:await stockSnapshot('stock-cursor:all'),metadata:await stockSnapshot('stock-metadata-checkpoint')});
 if(stockAutomaticPaused())return json({paused:true,message:stockPausedMessage},409);
 if(body.action!=='register')return json({error:'Invalid action'},400);
 return json(await ensureStockWebhook(new URL(request.url).origin));
 }catch(e){return failure(e);}}
