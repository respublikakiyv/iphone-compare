import {identity,json,failure} from '../../../../lib/auth';
import {importDeviceUrls} from '../../../../lib/cloud-refresh';
export async function POST(request:Request){try{const user=await identity(request);const text=await request.text();if(text.length>600000)return json({error:'Too large'},413);return json(await importDeviceUrls(user,JSON.parse(text).items));}catch(e){return failure(e);}}
