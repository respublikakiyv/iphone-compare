import {visitor,json,failure} from '../../../lib/auth';
import {catalogMetadata} from '../../../lib/catalog-state';
export async function GET(request:Request){try{return json(await catalogMetadata(await visitor(request)));}catch(e){return failure(e);}}
