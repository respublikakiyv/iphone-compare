import {visitor,json,failure} from '../../../lib/auth';
import {runRefreshStep} from '../../../lib/cloud-refresh';
import {catalogVersion} from '../../../lib/catalog-state';
export async function POST(request:Request){try{await visitor(request);const result=await runRefreshStep();return json({...result,catalogVersion:await catalogVersion()});}catch(e){return failure(e);}}
