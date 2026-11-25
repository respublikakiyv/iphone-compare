import {cleanOptionalStores} from '../../../lib/stores';
import {visitor,json,failure} from '../../../lib/auth';
import {readPersonalStores,writePersonalStores} from '../../../lib/personal-stores';
export async function GET(request:Request){try{const user=await visitor(request);return json({extraStores:user==='public'?[]:await readPersonalStores(user)});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await visitor(request);const text=await request.text();if(text.length>1000)return json({error:'Request too large'},413);const value=JSON.parse(text);try{return json({extraStores:user==='public'?cleanOptionalStores(value.extraStores):await writePersonalStores(user,value.extraStores)});}catch(e:any){if(e.message==='Некорректный список магазинов.')return json({error:e.message},400);throw e;}}catch(e){return failure(e);}}
