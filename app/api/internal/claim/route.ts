import {internal,json,failure} from '../../../../lib/auth';
export async function POST(request:Request){try{internal(request);return json({job:null,mode:'device-manual'});}catch(e){return failure(e);}}
