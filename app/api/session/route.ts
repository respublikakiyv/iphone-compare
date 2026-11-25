import {visitor,json,failure} from '../../../lib/auth';
export async function GET(request:Request){try{const user=await visitor(request);return json({user,provider:user==='public'?'public':request.headers.get('X-Telegram-Init-Data')?'telegram':'chatgpt'});}catch(e){return failure(e);}}
