import {queueStockEvent,drainStockEvents} from '../../../../lib/stock-webhook';
import {background} from '../../../../lib/background';
export async function POST(request:Request){try{const status=await queueStockEvent(request);if(status===204)background(drainStockEvents);return new Response(null,{status});}catch{return new Response(null,{status:503});}}
