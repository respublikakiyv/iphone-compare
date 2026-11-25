import {visitor,json,failure} from '../../../lib/auth';
import {configuration,publicSettings} from '../../../lib/admin';
export async function GET(request:Request){try{const user=await visitor(request),row=await configuration();return json({settings:publicSettings(row),isOwner:row?.owner===user,ownerConfigured:!!row});}catch(e){return failure(e);}}
